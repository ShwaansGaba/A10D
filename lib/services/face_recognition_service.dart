import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/registered_user.dart';
import 'supabase_sync_service.dart';

class LivenessSample {
  final double leftEye;
  final double rightEye;
  final double yaw;
  final double pitch;
  final DateTime timestamp;

  LivenessSample({
    required this.leftEye,
    required this.rightEye,
    required this.yaw,
    required this.pitch,
    required this.timestamp,
  });
}

class RecognitionResult {
  final bool isPersonDetected;
  final bool isRecognized;
  final RegisteredUser? user;
  final double confidence;
  final String message;
  final Face? detectedFace;
  final String? croppedFacePath;
  final bool isLivenessVerified;
  final String? livenessReason;

  RecognitionResult({
    required this.isPersonDetected,
    required this.isRecognized,
    this.user,
    this.confidence = 0.0,
    required this.message,
    this.detectedFace,
    this.croppedFacePath,
    this.isLivenessVerified = false,
    this.livenessReason,
  });
}

class FaceRecognitionService {
  static final FaceRecognitionService _instance =
      FaceRecognitionService._internal();
  factory FaceRecognitionService() => _instance;
  FaceRecognitionService._internal();

  static const String _usersKey = 'registered_attendance_faces_v5';
  // High-precision cosine similarity threshold & runner-up ambiguity margin
  static const double matchThreshold = 0.80;
  static const double ambiguityMargin = 0.07;

  // Sliding window buffer for liveness & anti-spoofing detection
  final List<LivenessSample> _livenessHistory = [];
  DateTime? _lastFaceSeenTime;

  // Optimized detector: accurate mode + classification enabled for eye probabilities
  late final FaceDetector _detector = FaceDetector(
    options: FaceDetectorOptions(
      enableContours: true,
      enableLandmarks: true,
      enableClassification: true, // Enables leftEyeOpenProbability & rightEyeOpenProbability
      performanceMode: FaceDetectorMode.accurate,
      minFaceSize: 0.12,
    ),
  );

  /// Load all registered users from local phone storage
  Future<List<RegisteredUser>> getRegisteredUsers() async {
    final prefs = await SharedPreferences.getInstance();
    final jsonList = prefs.getStringList(_usersKey) ?? [];
    return jsonList.map((jsonStr) => RegisteredUser.fromJson(jsonStr)).toList();
  }

  /// Clean old temporary frame caches so phone storage is never overloaded
  Future<void> cleanCache() async {
    try {
      final tempDir = await getTemporaryDirectory();
      final entities = tempDir.listSync();
      for (final entity in entities) {
        if (entity is File &&
            (entity.path.contains('live_frame_') ||
             entity.path.contains('crop_') ||
             entity.path.endsWith('.jpg') ||
             entity.path.endsWith('.jpeg'))) {
          try {
            await entity.delete();
          } catch (_) {}
        }
      }
    } catch (e) {
      debugPrint('Cache clean notice: $e');
    }
  }

  /// Register an employee with multi-view biometric embeddings
  Future<RegisteredUser> registerUserMultiView({
    required String name,
    String? phone,
    required String mainPhotoPath,
    required List<List<double>> embeddings,
    String? croppedPhotoPath,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final users = await getRegisteredUsers();

    final appDir = await getApplicationDocumentsDirectory();
    final fileName = 'face_${DateTime.now().millisecondsSinceEpoch}.jpg';
    final destinationPath = p.join(appDir.path, fileName);

    final sourcePath = croppedPhotoPath ?? mainPhotoPath;
    if (await File(sourcePath).exists()) {
      await File(sourcePath).copy(destinationPath);
    }

    final newUser = RegisteredUser(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      name: name.trim(),
      phone: phone?.trim(),
      photoPath: destinationPath,
      registeredAt: DateTime.now(),
      embeddings: embeddings,
    );

    users.add(newUser);
    final jsonList = users.map((u) => u.toJson()).toList();
    await prefs.setStringList(_usersKey, jsonList);

    return newUser;
  }

  /// Remove a registered user
  Future<void> deleteUser(String userId) async {
    final prefs = await SharedPreferences.getInstance();
    final users = await getRegisteredUsers();
    final userToDelete = users.where((u) => u.id == userId).firstOrNull;

    if (userToDelete != null) {
      try {
        final file = File(userToDelete.photoPath);
        if (await file.exists()) {
          await file.delete();
        }
      } catch (_) {}
    }

    users.removeWhere((u) => u.id == userId);
    await prefs.setStringList(_usersKey, users.map((u) => u.toJson()).toList());
    await cleanCache();
    await SupabaseSyncService().deleteEmployee(userId);
  }

  /// Completely wipe all registered face profiles and photos locally
  Future<void> resetAllFaceData() async {
    final prefs = await SharedPreferences.getInstance();
    final users = await getRegisteredUsers();
    for (final user in users) {
      try {
        final file = File(user.photoPath);
        if (await file.exists()) {
          await file.delete();
        }
      } catch (_) {}
    }
    await prefs.remove(_usersKey);
    await prefs.remove('registered_attendance_faces_v2');
    await prefs.remove('registered_attendance_faces');
    _livenessHistory.clear();
    _lastFaceSeenTime = null;
    await cleanCache();
    debugPrint('FaceRecognitionService: All local face data wiped.');
  }

  /// Live-sync local face cache with remote employees from Supabase (Authoritative Remote Sync)
  Future<void> syncFromRemoteEmployees(List<Map<String, dynamic>> remoteEmployees) async {
    final prefs = await SharedPreferences.getInstance();
    final localUsers = await getRegisteredUsers();

    // 1. If remoteEmployees is empty:
    // When logged into Supabase, an empty list means all employees were deleted or database reset!
    // We MUST clear the local cache so deleted employees are never resurrected or scanned!
    if (remoteEmployees.isEmpty) {
      if (SupabaseSyncService().isUserLoggedIn) {
        debugPrint('Remote employee roster is empty. Purging local face database to match cloud state...');
        for (final user in localUsers) {
          if (user.photoPath.isNotEmpty) {
            try {
              final f = File(user.photoPath);
              if (f.existsSync()) f.deleteSync();
            } catch (_) {}
          }
        }
        await prefs.remove(_usersKey);
        await prefs.remove('registered_attendance_faces_v2');
        await cleanCache();
        debugPrint('Local face database purged completely to match server.');
      }
      return;
    }

    final remoteNames = remoteEmployees
        .map((e) => (e['name'] as String?)?.trim().toLowerCase())
        .whereType<String>()
        .toSet();
    final remoteIds = remoteEmployees
        .map((e) => e['id']?.toString())
        .whereType<String>()
        .toSet();

    // 2. Filter localUsers: ONLY KEEP users that still exist on Supabase!
    // If a user was deleted on the web or another terminal, REMOVE them from this device immediately!
    final updatedList = <RegisteredUser>[];
    for (final user in localUsers) {
      final matchesName = remoteNames.contains(user.name.trim().toLowerCase());
      final matchesId = remoteIds.contains(user.id);

      if (matchesName || matchesId) {
        updatedList.add(user);
      } else {
        debugPrint('Employee ${user.name} was removed on server. Deleting from local face cache...');
        if (user.photoPath.isNotEmpty) {
          try {
            final f = File(user.photoPath);
            if (f.existsSync()) f.deleteSync();
          } catch (_) {}
        }
      }
    }

    // 3. Import any remote employees that have photo or embeddings and are not yet in local cache
    for (final emp in remoteEmployees) {
      final name = emp['name'] as String?;
      if (name == null || name.trim().isEmpty) continue;
      final empId = emp['id']?.toString() ?? DateTime.now().millisecondsSinceEpoch.toString();
      final hasLocal = updatedList.any((u) => u.name.trim().toLowerCase() == name.trim().toLowerCase());

      if (!hasLocal) {
        List<List<double>> parsedEmbeddings = [];
        try {
          final rawEmbeddings = emp['embeddings'];
          if (rawEmbeddings is List) {
            for (final item in rawEmbeddings) {
              if (item is List) {
                parsedEmbeddings.add(item.map((e) => (e as num).toDouble()).toList());
              }
            }
          }
        } catch (_) {}

        String localPhotoPath = '';
        final photoUrl = emp['photo_url'] as String?;
        if (photoUrl != null && photoUrl.startsWith('data:image')) {
          try {
            final commaIdx = photoUrl.indexOf(',');
            if (commaIdx != -1) {
              final base64Str = photoUrl.substring(commaIdx + 1);
              final bytes = base64Decode(base64Str);
              final appDir = await getApplicationDocumentsDirectory();
              final fileName = 'cloud_face_${empId}_${DateTime.now().millisecondsSinceEpoch}.jpg';
              final file = File(p.join(appDir.path, fileName));
              await file.writeAsBytes(bytes);
              localPhotoPath = file.path;
            }
          } catch (_) {}
        } else if (photoUrl != null && photoUrl.isNotEmpty) {
          if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
            try {
              final client = HttpClient();
              final request = await client.getUrl(Uri.parse(photoUrl));
              final response = await request.close();
              if (response.statusCode == 200) {
                final bytes = await consolidateHttpClientResponseBytes(response);
                final appDir = await getApplicationDocumentsDirectory();
                final fileName = 'cloud_face_${empId}_${DateTime.now().millisecondsSinceEpoch}.jpg';
                final file = File(p.join(appDir.path, fileName));
                await file.writeAsBytes(bytes);
                localPhotoPath = file.path;
              }
            } catch (e) {
              debugPrint('Notice downloading remote face photo for ${name.trim()}: $e');
            }
          } else {
            localPhotoPath = photoUrl;
          }
        }

        // BIOMETRIC RESOLUTION: If photo is available, extract the exact ML Kit geometric vector!
        // This ensures employees enrolled on the web client or uploaded via photo are seamlessly
        // scanned and recognized by the mobile camera!
        if (localPhotoPath.isNotEmpty && File(localPhotoPath).existsSync()) {
          try {
            final extraction = await extractFaceEmbedding(localPhotoPath);
            if (extraction != null && extraction.embedding.isNotEmpty) {
              parsedEmbeddings = [extraction.embedding];
              debugPrint('Biometric vector computed from photo for employee: ${name.trim()}');
            }
          } catch (e) {
            debugPrint('ML Kit photo feature extraction notice for ${name.trim()}: $e');
          }
        }

        if (parsedEmbeddings.isNotEmpty || localPhotoPath.isNotEmpty) {
          final newUser = RegisteredUser(
            id: empId,
            name: name.trim(),
            phone: emp['phone'] as String?,
            photoPath: localPhotoPath,
            registeredAt: emp['created_at'] != null ? DateTime.tryParse(emp['created_at']) ?? DateTime.now() : DateTime.now(),
            embeddings: parsedEmbeddings,
          );
          updatedList.add(newUser);
          debugPrint('Synced employee from remote into local face database: ${newUser.name} (Embeddings: ${parsedEmbeddings.length})');
        }
      }
    }

    await prefs.setStringList(_usersKey, updatedList.map((u) => u.toJson()).toList());
    debugPrint('FaceRecognitionService: Local face database reconciled with ${updatedList.length} enrolled users.');
  }

  /// High-speed biometric embedding extraction with scale-invariant geometry and visual grid
  Future<({Face face, List<double> embedding, String? croppedPath})?>
      extractFaceEmbedding(String imagePath, {bool generateCrop = false}) async {
    final inputImage = InputImage.fromFilePath(imagePath);
    final faces = await _detector.processImage(inputImage);

    if (faces.isEmpty) {
      return null;
    }

    // Select primary face
    faces.sort((a, b) {
      final areaA = a.boundingBox.width * a.boundingBox.height;
      final areaB = b.boundingBox.width * b.boundingBox.height;
      return areaB.compareTo(areaA);
    });

    final primaryFace = faces.first;
    String? croppedPath;
    img.Image? faceCrop;

    try {
      final file = File(imagePath);
      final bytes = await file.readAsBytes();
      final decoded = img.decodeImage(bytes);

      if (decoded != null) {
        final box = primaryFace.boundingBox;
        final padX = (box.width * 0.15).toInt();
        final padY = (box.height * 0.15).toInt();

        final x = math.max(0, (box.left.toInt() - padX));
        final y = math.max(0, (box.top.toInt() - padY));
        final w = math.min(decoded.width - x, (box.width.toInt() + padX * 2));
        final h = math.min(decoded.height - y, (box.height.toInt() + padY * 2));

        if (w > 10 && h > 10) {
          faceCrop = img.copyCrop(decoded, x: x, y: y, width: w, height: h);
          if (generateCrop) {
            final tempDir = await getTemporaryDirectory();
            final cropFile = File(
              p.join(tempDir.path, 'crop_${DateTime.now().millisecondsSinceEpoch}.jpg'),
            );
            await cropFile.writeAsBytes(img.encodeJpg(faceCrop, quality: 80));
            croppedPath = cropFile.path;
          }
        }
      }
    } catch (e) {
      debugPrint('Crop generation notice: $e');
    }

    final biometricFeatures = _buildBiometricVector(primaryFace, faceCrop);
    final normalizedEmbedding = _l2Normalize(biometricFeatures);

    return (
      face: primaryFace,
      embedding: normalizedEmbedding,
      croppedPath: croppedPath,
    );
  }

  /// Fast live recognition with blink and head movement anti-spoofing verification
  Future<RecognitionResult> recognizeFaceFast(String imagePath) async {
    final extraction = await extractFaceEmbedding(imagePath, generateCrop: false);

    final now = DateTime.now();

    if (extraction == null) {
      // Clear liveness history if nobody has been seen for > 1.8 seconds
      if (_lastFaceSeenTime != null && now.difference(_lastFaceSeenTime!).inMilliseconds > 1800) {
        _livenessHistory.clear();
      }
      return RecognitionResult(
        isPersonDetected: false,
        isRecognized: false,
        message: 'No person detected',
      );
    }

    _lastFaceSeenTime = now;
    final face = extraction.face;

    // Process liveness sample (eye openness + 3D head pose)
    final leftEye = face.leftEyeOpenProbability ?? 0.5;
    final rightEye = face.rightEyeOpenProbability ?? 0.5;
    final yaw = face.headEulerAngleY ?? 0.0;
    final pitch = face.headEulerAngleX ?? 0.0;

    _livenessHistory.add(LivenessSample(
      leftEye: leftEye,
      rightEye: rightEye,
      yaw: yaw,
      pitch: pitch,
      timestamp: now,
    ));

    // Keep sliding window of latest 7 frames (~2.5-3 seconds)
    if (_livenessHistory.length > 7) {
      _livenessHistory.removeAt(0);
    }

    // Evaluate liveness criteria:
    final ({bool isLive, String reason}) livenessCheck = _evaluateLiveness();

    final registeredUsers = await getRegisteredUsers();

    if (registeredUsers.isEmpty) {
      return RecognitionResult(
        isPersonDetected: true,
        isRecognized: false,
        detectedFace: face,
        isLivenessVerified: livenessCheck.isLive,
        livenessReason: livenessCheck.reason,
        message: 'No registered faces in database.',
      );
    }

    RegisteredUser? bestMatch;
    double highestScore = -1.0;
    double secondHighestScore = -1.0;

    for (final candidate in registeredUsers) {
      double candidateMax = -1.0;
      for (final viewEmbedding in candidate.embeddings) {
        final similarity = _calculateCosineSimilarity(
          extraction.embedding,
          viewEmbedding,
        );

        if (similarity > candidateMax) {
          candidateMax = similarity;
        }
      }

      if (candidateMax > highestScore) {
        secondHighestScore = highestScore;
        highestScore = candidateMax;
        bestMatch = candidate;
      } else if (candidateMax > secondHighestScore) {
        secondHighestScore = candidateMax;
      }
    }

    final bool hasAmbiguity = registeredUsers.length > 1 &&
        (highestScore - secondHighestScore) < ambiguityMargin;

    if (highestScore >= matchThreshold && bestMatch != null && !hasAmbiguity) {
      return RecognitionResult(
        isPersonDetected: true,
        isRecognized: true,
        user: bestMatch,
        confidence: highestScore,
        detectedFace: face,
        isLivenessVerified: livenessCheck.isLive,
        livenessReason: livenessCheck.reason,
        message: bestMatch.name,
      );
    } else if (hasAmbiguity && highestScore >= matchThreshold) {
      return RecognitionResult(
        isPersonDetected: true,
        isRecognized: false,
        confidence: highestScore,
        detectedFace: face,
        isLivenessVerified: false,
        livenessReason: 'Multiple matching profiles — face camera directly',
        message: 'Ambiguous Face Match',
      );
    } else {
      return RecognitionResult(
        isPersonDetected: true,
        isRecognized: false,
        confidence: math.max(0.0, highestScore),
        detectedFace: face,
        isLivenessVerified: livenessCheck.isLive,
        livenessReason: livenessCheck.reason,
        message: 'Unrecognized Face',
      );
    }
  }

  /// Verifies natural blinking or 3D head motion to prevent photo/screen spoofing
  ({bool isLive, String reason}) _evaluateLiveness() {
    if (_livenessHistory.length < 2) {
      // Need at least 2 frames to measure motion or blink
      return (isLive: false, reason: 'Verifying liveness...');
    }

    // 1. Check for Blink (Transition in eye openness: open -> shut or delta > 0.30)
    for (int i = 0; i < _livenessHistory.length - 1; i++) {
      final prev = (_livenessHistory[i].leftEye + _livenessHistory[i].rightEye) / 2.0;
      final curr = (_livenessHistory[i + 1].leftEye + _livenessHistory[i + 1].rightEye) / 2.0;
      final delta = (prev - curr).abs();

      if (delta >= 0.28 || (prev > 0.65 && curr < 0.35) || (prev < 0.35 && curr > 0.65)) {
        return (isLive: true, reason: 'Blink detected');
      }
    }

    // 2. Check for Natural Head Movement (Delta in yaw or pitch > 2.8 degrees)
    double minYaw = _livenessHistory.first.yaw;
    double maxYaw = _livenessHistory.first.yaw;
    double minPitch = _livenessHistory.first.pitch;
    double maxPitch = _livenessHistory.first.pitch;

    for (final s in _livenessHistory) {
      if (s.yaw < minYaw) minYaw = s.yaw;
      if (s.yaw > maxYaw) maxYaw = s.yaw;
      if (s.pitch < minPitch) minPitch = s.pitch;
      if (s.pitch > maxPitch) maxPitch = s.pitch;
    }

    final yawDelta = maxYaw - minYaw;
    final pitchDelta = maxPitch - minPitch;

    if (yawDelta >= 2.8 || pitchDelta >= 2.8) {
      return (isLive: true, reason: 'Motion verified');
    }

    return (isLive: false, reason: 'Blink or turn head slightly');
  }

  List<double> _buildBiometricVector(Face face, [img.Image? faceCrop]) {
    final box = face.boundingBox;
    final w = box.width.abs() > 0 ? box.width : 1.0;
    final h = box.height.abs() > 0 ? box.height : 1.0;

    final List<double> vec = [];

    // 1. Identify eye center & inter-ocular distance
    final leftEye = face.landmarks[FaceLandmarkType.leftEye]?.position;
    final rightEye = face.landmarks[FaceLandmarkType.rightEye]?.position;
    final nose = face.landmarks[FaceLandmarkType.noseBase]?.position;
    final leftMouth = face.landmarks[FaceLandmarkType.leftMouth]?.position;
    final rightMouth = face.landmarks[FaceLandmarkType.rightMouth]?.position;
    final bottomMouth = face.landmarks[FaceLandmarkType.bottomMouth]?.position;
    final leftCheek = face.landmarks[FaceLandmarkType.leftCheek]?.position;
    final rightCheek = face.landmarks[FaceLandmarkType.rightCheek]?.position;
    final leftEar = face.landmarks[FaceLandmarkType.leftEar]?.position;
    final rightEar = face.landmarks[FaceLandmarkType.rightEar]?.position;

    double eyeMidX, eyeMidY, eyeDist;
    if (leftEye != null && rightEye != null) {
      eyeMidX = (leftEye.x + rightEye.x) / 2.0;
      eyeMidY = (leftEye.y + rightEye.y) / 2.0;
      eyeDist = math.sqrt(
        math.pow(rightEye.x - leftEye.x, 2) + math.pow(rightEye.y - leftEye.y, 2),
      );
    } else {
      eyeMidX = box.left + w * 0.5;
      eyeMidY = box.top + h * 0.38;
      eyeDist = w * 0.42;
    }
    if (eyeDist < 5.0) eyeDist = math.max(10.0, w * 0.42);

    // 2. Zero-centered, scale-invariant landmark deviations from canonical facial template
    final landmarkConfigs = [
      (leftEye, -0.50, 0.00),
      (rightEye, 0.50, 0.00),
      (nose, 0.00, 0.90),
      (leftMouth, -0.38, 1.45),
      (rightMouth, 0.38, 1.45),
      (bottomMouth, 0.00, 1.65),
      (leftCheek, -0.95, 0.85),
      (rightCheek, 0.95, 0.85),
      (leftEar, -1.45, 0.35),
      (rightEar, 1.45, 0.35),
    ];

    for (final cfg in landmarkConfigs) {
      final pos = cfg.$1;
      final canX = cfg.$2;
      final canY = cfg.$3;
      if (pos != null) {
        final relX = (pos.x - eyeMidX) / eyeDist;
        final relY = (pos.y - eyeMidY) / eyeDist;
        vec.add((relX - canX).clamp(-1.5, 1.5));
        vec.add((relY - canY).clamp(-1.5, 1.5));
      } else {
        vec.add(0.0);
        vec.add(0.0);
      }
    }

    // 3. Biometric Anthropometric Ratios (Scale and Pose Invariant)
    vec.add(((w / h) - 0.78).clamp(-1.0, 1.0)); // Aspect ratio deviation
    vec.add(((eyeDist / w) - 0.42).clamp(-0.5, 0.5)); // Inter-ocular breadth
    if (nose != null) {
      vec.add((((nose.y - eyeMidY) / eyeDist) - 0.90).clamp(-1.0, 1.0)); // Nasal height index
      vec.add(((nose.x - eyeMidX) / eyeDist).clamp(-0.5, 0.5)); // Nasal midline deviation
    } else {
      vec.add(0.0);
      vec.add(0.0);
    }

    if (leftMouth != null && rightMouth != null) {
      final mouthW = math.sqrt(
        math.pow(rightMouth.x - leftMouth.x, 2) + math.pow(rightMouth.y - leftMouth.y, 2),
      );
      vec.add(((mouthW / eyeDist) - 0.76).clamp(-1.0, 1.0)); // Cheilion mouth breadth
    } else {
      vec.add(0.0);
    }

    if (nose != null && bottomMouth != null) {
      vec.add((((bottomMouth.y - nose.y) / eyeDist) - 0.75).clamp(-1.0, 1.0)); // Lower third height
    } else {
      vec.add(0.0);
    }

    if (leftCheek != null && rightCheek != null) {
      final cheekSpan = math.sqrt(
        math.pow(rightCheek.x - leftCheek.x, 2) + math.pow(rightCheek.y - leftCheek.y, 2),
      );
      vec.add(((cheekSpan / w) - 0.75).clamp(-1.0, 1.0)); // Bizygomatic breadth
    } else {
      vec.add(0.0);
    }

    // 4. Sample 16 normalized points along jawline/mandible contour
    final faceContour = face.contours[FaceContourType.face]?.points;
    if (faceContour != null && faceContour.isNotEmpty) {
      final step = math.max(1, faceContour.length ~/ 16);
      for (int i = 0; i < 16; i++) {
        final idx = (i * step) % faceContour.length;
        final pt = faceContour[idx];
        final relX = (pt.x - eyeMidX) / eyeDist;
        final relY = (pt.y - eyeMidY) / eyeDist;
        final angle = (i / 16.0) * math.pi;
        final idealX = 1.35 * math.cos(angle);
        final idealY = 1.65 * math.sin(angle);
        vec.add((relX - idealX).clamp(-2.0, 2.0));
        vec.add((relY - idealY).clamp(-2.0, 2.0));
      }
    } else {
      for (int i = 0; i < 32; i++) {
        vec.add(0.0);
      }
    }

    // 5. Visual Spatial Grid Texture Extraction (if face image crop available)
    if (faceCrop != null) {
      try {
        final resized = img.copyResize(faceCrop, width: 36, height: 36);
        double sumLum = 0.0;
        double sumLumSq = 0.0;
        final lumGrid = List<double>.filled(36 * 36, 0.0);

        for (int y = 0; y < 36; y++) {
          for (int x = 0; x < 36; x++) {
            final pixel = resized.getPixel(x, y);
            final lum = 0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b;
            final idx = y * 36 + x;
            lumGrid[idx] = lum;
            sumLum += lum;
            sumLumSq += lum * lum;
          }
        }

        final meanLum = sumLum / (36.0 * 36.0);
        final stdLum = math.max(1.0, math.sqrt((sumLumSq / (36.0 * 36.0)) - (meanLum * meanLum)));

        // 6x6 spatial cells (6x6 pixels each)
        for (int cy = 0; cy < 6; cy++) {
          for (int cx = 0; cx < 6; cx++) {
            double cellSum = 0.0;
            double cellGradX = 0.0;
            double cellGradY = 0.0;
            for (int py = cy * 6; py < (cy + 1) * 6; py++) {
              for (int px = cx * 6; px < (cx + 1) * 6; px++) {
                final idx = py * 36 + px;
                cellSum += (lumGrid[idx] - meanLum) / stdLum;

                final left = px > 0 ? lumGrid[py * 36 + (px - 1)] : lumGrid[idx];
                final right = px < 35 ? lumGrid[py * 36 + (px + 1)] : lumGrid[idx];
                final top = py > 0 ? lumGrid[(py - 1) * 36 + px] : lumGrid[idx];
                final bottom = py < 35 ? lumGrid[(py + 1) * 36 + px] : lumGrid[idx];
                cellGradX += (right - left) / stdLum;
                cellGradY += (bottom - top) / stdLum;
              }
            }
            vec.add((cellSum / 36.0).clamp(-3.0, 3.0));
            vec.add((cellGradX / 36.0).clamp(-3.0, 3.0));
            vec.add((cellGradY / 36.0).clamp(-3.0, 3.0));
          }
        }
      } catch (e) {
        debugPrint('Visual grid extraction fallback: $e');
      }
    }

    return vec;
  }

  List<double> _l2Normalize(List<double> vector) {
    double sumSquares = 0.0;
    for (final v in vector) {
      sumSquares += v * v;
    }
    final norm = math.sqrt(sumSquares);
    if (norm < 1e-9) return List.filled(vector.length, 0.0);
    return vector.map((v) => v / norm).toList();
  }

  double _calculateCosineSimilarity(List<double> vecA, List<double> vecB) {
    final len = math.min(vecA.length, vecB.length);
    if (len == 0) return 0.0;
    double dotProduct = 0.0;
    for (int i = 0; i < len; i++) {
      dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct.clamp(-1.0, 1.0);
  }

  void dispose() {
    _detector.close();
  }
}
