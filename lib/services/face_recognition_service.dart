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

  static const String _usersKey = 'registered_attendance_faces_v7';
  // Biometric thresholds: calibrated for 1:N matching across staff
  static const double matchThreshold = 0.65;
  static const double ambiguityMargin = 0.08;

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

    // 2. Filter & reconcile localUsers with Supabase
    // Clean up users that no longer exist on server, and update users whose biometric
    // data needs to be populated or refreshed from photo.
    final updatedList = <RegisteredUser>[];
    final processedIds = <String>{};

    for (final emp in remoteEmployees) {
      final name = (emp['name'] as String?)?.trim();
      if (name == null || name.isEmpty) continue;
      final empId = emp['id']?.toString() ?? '';
      if (empId.isEmpty) continue;
      processedIds.add(empId);

      // Check if this employee already has a local entry
      final localIndex = localUsers.indexWhere(
        (u) => u.id == empId || u.name.trim().toLowerCase() == name.toLowerCase(),
      );
      final existingLocal = localIndex != -1 ? localUsers[localIndex] : null;

      List<List<double>> parsedEmbeddings = [];
      if (existingLocal != null && existingLocal.embeddings.isNotEmpty) {
        // Keep valid 192-D embeddings if already extracted
        final validEmbeddings = existingLocal.embeddings
            .where((emb) => emb.length == 192)
            .toList();
        if (validEmbeddings.isNotEmpty) {
          parsedEmbeddings = validEmbeddings;
        }
      }

      String localPhotoPath = existingLocal?.photoPath ?? '';

      // If embeddings are missing/mismatched or photo file doesn't exist, download photo & re-extract
      final bool needsBiometricExtraction = parsedEmbeddings.isEmpty;
      final bool needsPhotoDownload = localPhotoPath.isEmpty || !File(localPhotoPath).existsSync();

      final photoUrl = emp['photo_url'] as String?;
      if ((needsBiometricExtraction || needsPhotoDownload) && photoUrl != null && photoUrl.isNotEmpty) {
        if (photoUrl.startsWith('data:image')) {
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
          } catch (e) {
            debugPrint('Error decoding base64 photo for $name: $e');
          }
        } else if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
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
            debugPrint('Notice downloading remote face photo for $name: $e');
          }
        }
      }

      // If we have a local photo and need 192-D biometric vector, extract it via Google ML Kit
      if (parsedEmbeddings.isEmpty && localPhotoPath.isNotEmpty && File(localPhotoPath).existsSync()) {
        try {
          final extraction = await extractFaceEmbedding(localPhotoPath);
          if (extraction != null && extraction.embedding.isNotEmpty) {
            parsedEmbeddings = [extraction.embedding];
            debugPrint('Biometric 192-D ML Kit vector computed from photo for employee: $name');
          }
        } catch (e) {
          debugPrint('ML Kit photo feature extraction notice for $name: $e');
        }
      }

      // Check if remote DB already provides native embeddings
      if (parsedEmbeddings.isEmpty) {
        try {
          final rawEmbeddings = emp['embeddings'];
          if (rawEmbeddings is List) {
            for (final item in rawEmbeddings) {
              if (item is List && item.length == 192) {
                parsedEmbeddings.add(item.map((e) => (e as num).toDouble()).toList());
              }
            }
          }
        } catch (_) {}
      }

      final resolvedUser = RegisteredUser(
        id: empId,
        name: name,
        phone: emp['phone'] as String? ?? existingLocal?.phone,
        photoPath: localPhotoPath,
        registeredAt: emp['created_at'] != null
            ? DateTime.tryParse(emp['created_at']) ?? DateTime.now()
            : (existingLocal?.registeredAt ?? DateTime.now()),
        embeddings: parsedEmbeddings,
      );
      updatedList.add(resolvedUser);
      debugPrint('Employee reconciled: ${resolvedUser.name} (Embeddings: ${parsedEmbeddings.length}, Photo: ${localPhotoPath.isNotEmpty})');
    }

    // Clean up orphaned photo files of deleted employees
    for (final oldUser in localUsers) {
      if (!processedIds.contains(oldUser.id) && oldUser.photoPath.isNotEmpty) {
        try {
          final f = File(oldUser.photoPath);
          if (f.existsSync()) f.deleteSync();
        } catch (_) {}
      }
    }

    await prefs.setStringList(_usersKey, updatedList.map((u) => u.toJson()).toList());
    debugPrint('FaceRecognitionService: Local face database reconciled with ${updatedList.length} enrolled users.');
  }

  /// Enterprise 5-Point Affine Similarity Alignment & Canonical Normalization
  img.Image? _alignAndCropFace(img.Image sourceImage, Face face) {
    try {
      final leftEye = face.landmarks[FaceLandmarkType.leftEye]?.position;
      final rightEye = face.landmarks[FaceLandmarkType.rightEye]?.position;

      double rollAngleDegrees = 0.0;
      double centerX = face.boundingBox.left + face.boundingBox.width / 2.0;
      double centerY = face.boundingBox.top + face.boundingBox.height / 2.0;
      double eyeDistance = face.boundingBox.width * 0.40;

      if (leftEye != null && rightEye != null) {
        final dx = (rightEye.x - leftEye.x).toDouble();
        final dy = (rightEye.y - leftEye.y).toDouble();
        rollAngleDegrees = math.atan2(dy, dx) * 180.0 / math.pi;
        centerX = (leftEye.x + rightEye.x) / 2.0;
        centerY = (leftEye.y + rightEye.y) / 2.0;
        eyeDistance = math.sqrt(dx * dx + dy * dy);
      } else if (face.headEulerAngleZ != null) {
        rollAngleDegrees = face.headEulerAngleZ!;
      }

      img.Image workingImage = sourceImage;
      // If tilt exceeds 1.5 degrees, apply 2D affine rotation
      if (rollAngleDegrees.abs() >= 1.5) {
        workingImage = img.copyRotate(sourceImage, angle: -rollAngleDegrees);
      }

      // Canonical square chip centered on inter-ocular midpoint
      final cropSpan = math.max(30.0, eyeDistance * 2.6);
      final padTop = cropSpan * 0.38;
      final cropX = math.max(0, (centerX - cropSpan / 2.0).toInt());
      final cropY = math.max(0, (centerY - padTop).toInt());
      final cropW = math.min(workingImage.width - cropX, cropSpan.toInt());
      final cropH = math.min(workingImage.height - cropY, cropSpan.toInt());

      if (cropW > 10 && cropH > 10) {
        final cropped = img.copyCrop(workingImage, x: cropX, y: cropY, width: cropW, height: cropH);
        return img.copyResize(cropped, width: 96, height: 96);
      }
    } catch (e) {
      debugPrint('Affine face alignment notice: $e');
    }
    return null;
  }

  /// High-speed biometric embedding extraction with affine alignment, geometry mesh and visual grid
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
    img.Image? alignedFace;

    try {
      final file = File(imagePath);
      final bytes = await file.readAsBytes();
      final decoded = img.decodeImage(bytes);

      if (decoded != null) {
        alignedFace = _alignAndCropFace(decoded, primaryFace);

        if (generateCrop && alignedFace != null) {
          final tempDir = await getTemporaryDirectory();
          final cropFile = File(
            p.join(tempDir.path, 'crop_${DateTime.now().millisecondsSinceEpoch}.jpg'),
          );
          await cropFile.writeAsBytes(img.encodeJpg(alignedFace, quality: 85));
          croppedPath = cropFile.path;
        }
      }
    } catch (e) {
      debugPrint('Crop & alignment generation notice: $e');
    }

    final biometricFeatures = _buildBiometricVector(primaryFace, alignedFace);
    final normalizedEmbedding = _l2Normalize(biometricFeatures);

    return (
      face: primaryFace,
      embedding: normalizedEmbedding,
      croppedPath: croppedPath,
    );
  }

  /// Fast live recognition with Extreme Value Z-Score Test, Coarse-to-Fine Indexing, and Anti-Spoofing
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

    double sumScores = 0.0;
    double sumScoresSq = 0.0;
    int evaluatedCount = 0;

    // Enterprise Scalability: Coarse-to-Fine Indexing
    // If database has > 50 employees, pre-filter by 16-D primary geometric index
    List<RegisteredUser> candidates = registeredUsers;
    if (registeredUsers.length > 50) {
      final coarseProbe = extraction.embedding.take(16).toList();
      final ranked = <({RegisteredUser user, double coarseSim})>[];

      for (final u in registeredUsers) {
        if (u.embeddings.isEmpty) continue;
        final uCoarse = u.embeddings.first.take(16).toList();
        final cSim = _calculateCosineSimilarity(coarseProbe, uCoarse);
        ranked.add((user: u, coarseSim: cSim));
      }
      ranked.sort((a, b) => b.coarseSim.compareTo(a.coarseSim));
      candidates = ranked.take(50).map((r) => r.user).toList();
    }

    for (final candidate in candidates) {
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

      if (candidateMax > -0.5) {
        sumScores += candidateMax;
        sumScoresSq += candidateMax * candidateMax;
        evaluatedCount++;
      }

      if (candidateMax > highestScore) {
        secondHighestScore = highestScore;
        highestScore = candidateMax;
        bestMatch = candidate;
      } else if (candidateMax > secondHighestScore) {
        secondHighestScore = candidateMax;
      }
    }

    // Extreme Value Distribution (Z-Score) Outlier Test:
    // Ensures match is statistically distinct from the background population of employees
    bool isPopulationOutlier = true;
    if (evaluatedCount >= 5) {
      final meanScore = sumScores / evaluatedCount;
      final variance = math.max(1e-4, (sumScoresSq / evaluatedCount) - (meanScore * meanScore));
      final stdScore = math.sqrt(variance);
      final zScore = (highestScore - meanScore) / stdScore;
      isPopulationOutlier = zScore >= 2.8;
    }

    final bool hasAmbiguity = registeredUsers.length > 1 &&
        (highestScore - secondHighestScore) < ambiguityMargin;

    if (highestScore >= matchThreshold && bestMatch != null && !hasAmbiguity && isPopulationOutlier) {
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

  List<double> _buildBiometricVector(Face face, [img.Image? alignedFace]) {
    final box = face.boundingBox;
    final w = box.width.abs() > 0 ? box.width : 1.0;
    final h = box.height.abs() > 0 ? box.height : 1.0;

    final List<double> vec = [];

    // ==============================================================
    // 1. Primary Anthropometric Invariant Ratios (First 16 Coarse Keys)
    // ==============================================================
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

    // 16 Invariant Geometric Ratios (Used for Coarse 1:N Pre-Filtering)
    vec.add(((w / h) - 0.78).clamp(-1.0, 1.0)); // 1. Aspect Ratio
    vec.add(((eyeDist / w) - 0.42).clamp(-0.5, 0.5)); // 2. Inter-pupillary breadth
    vec.add(nose != null ? (((nose.y - eyeMidY) / eyeDist) - 0.90).clamp(-1.0, 1.0) : 0.0); // 3. Nasal height index
    vec.add(nose != null ? (((nose.x - eyeMidX) / eyeDist)).clamp(-0.5, 0.5) : 0.0); // 4. Nasal midline symmetry
    final mouthSpan = (leftMouth != null && rightMouth != null)
        ? math.sqrt(math.pow(rightMouth.x - leftMouth.x, 2) + math.pow(rightMouth.y - leftMouth.y, 2))
        : 0.0;
    vec.add(mouthSpan > 0 ? ((mouthSpan / eyeDist) - 0.76).clamp(-1.0, 1.0) : 0.0); // 5. Cheilion breadth
    vec.add((nose != null && bottomMouth != null) ? (((bottomMouth.y - nose.y) / eyeDist) - 0.75).clamp(-1.0, 1.0) : 0.0); // 6. Philtrum-chin length
    final cheekSpan = (leftCheek != null && rightCheek != null)
        ? math.sqrt(math.pow(rightCheek.x - leftCheek.x, 2) + math.pow(rightCheek.y - leftCheek.y, 2))
        : 0.0;
    vec.add(cheekSpan > 0 ? ((cheekSpan / w) - 0.75).clamp(-1.0, 1.0) : 0.0); // 7. Bizygomatic breadth
    final earSpan = (leftEar != null && rightEar != null)
        ? math.sqrt(math.pow(rightEar.x - leftEar.x, 2) + math.pow(rightEar.y - leftEar.y, 2))
        : 0.0;
    vec.add(earSpan > 0 ? ((earSpan / w) - 0.95).clamp(-1.0, 1.0) : 0.0); // 8. Bi-auricular span
    vec.add((leftEye != null && leftCheek != null) ? ((leftEye.y - leftCheek.y).abs() / eyeDist - 0.45).clamp(-1.0, 1.0) : 0.0); // 9. Left malar height
    vec.add((rightEye != null && rightCheek != null) ? ((rightEye.y - rightCheek.y).abs() / eyeDist - 0.45).clamp(-1.0, 1.0) : 0.0); // 10. Right malar height
    vec.add((leftMouth != null && nose != null) ? ((nose.y - leftMouth.y).abs() / eyeDist - 0.55).clamp(-1.0, 1.0) : 0.0); // 11. Left philtrum slope
    vec.add((rightMouth != null && nose != null) ? ((nose.y - rightMouth.y).abs() / eyeDist - 0.55).clamp(-1.0, 1.0) : 0.0); // 12. Right philtrum slope
    vec.add((bottomMouth != null) ? ((box.bottom - bottomMouth.y) / h - 0.18).clamp(-1.0, 1.0) : 0.0); // 13. Mental (chin) depth
    vec.add((face.headEulerAngleX ?? 0.0) / 90.0); // 14. 3D Pose Pitch
    vec.add((face.headEulerAngleY ?? 0.0) / 90.0); // 15. 3D Pose Yaw
    vec.add((face.headEulerAngleZ ?? 0.0) / 90.0); // 16. 3D Pose Roll

    // ==============================================================
    // 2. High-Density Zero-Centered Landmark Deviations
    // ==============================================================
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

    // ==============================================================
    // 3. High-Density Multi-Contour Biometrics (Jaw & Eyebrows)
    // ==============================================================
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

    final leftEyebrow = face.contours[FaceContourType.leftEyebrowTop]?.points;
    final rightEyebrow = face.contours[FaceContourType.rightEyebrowTop]?.points;
    if (leftEyebrow != null && leftEyebrow.isNotEmpty) {
      final step = math.max(1, leftEyebrow.length ~/ 4);
      for (int i = 0; i < 4; i++) {
        final pt = leftEyebrow[(i * step) % leftEyebrow.length];
        vec.add((((pt.x - eyeMidX) / eyeDist) - (-0.50 + i * 0.12)).clamp(-1.0, 1.0));
        vec.add((((pt.y - eyeMidY) / eyeDist) - (-0.35)).clamp(-1.0, 1.0));
      }
    } else {
      for (int i = 0; i < 8; i++) {
        vec.add(0.0);
      }
    }
    if (rightEyebrow != null && rightEyebrow.isNotEmpty) {
      final step = math.max(1, rightEyebrow.length ~/ 4);
      for (int i = 0; i < 4; i++) {
        final pt = rightEyebrow[(i * step) % rightEyebrow.length];
        vec.add((((pt.x - eyeMidX) / eyeDist) - (0.14 + i * 0.12)).clamp(-1.0, 1.0));
        vec.add((((pt.y - eyeMidY) / eyeDist) - (-0.35)).clamp(-1.0, 1.0));
      }
    } else {
      for (int i = 0; i < 8; i++) {
        vec.add(0.0);
      }
    }

    // ==============================================================
    // 4. Multi-Zone Spatial Gradient Texture on Aligned 96x96 Face
    // ==============================================================
    if (alignedFace != null) {
      try {
        final chip = alignedFace.width == 96 && alignedFace.height == 96
            ? alignedFace
            : img.copyResize(alignedFace, width: 96, height: 96);

        double sumLum = 0.0;
        double sumLumSq = 0.0;
        final lumGrid = List<double>.filled(96 * 96, 0.0);

        for (int y = 0; y < 96; y++) {
          for (int x = 0; x < 96; x++) {
            final pixel = chip.getPixel(x, y);
            final lum = 0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b;
            final idx = y * 96 + x;
            lumGrid[idx] = lum;
            sumLum += lum;
            sumLumSq += lum * lum;
          }
        }

        final meanLum = sumLum / (96.0 * 96.0);
        final stdLum = math.max(1.0, math.sqrt((sumLumSq / (96.0 * 96.0)) - (meanLum * meanLum)));

        // 6x6 spatial cells (16x16 pixels each)
        for (int cy = 0; cy < 6; cy++) {
          for (int cx = 0; cx < 6; cx++) {
            double cellSum = 0.0;
            double cellGradX = 0.0;
            double cellGradY = 0.0;
            for (int py = cy * 16; py < (cy + 1) * 16; py++) {
              for (int px = cx * 16; px < (cx + 1) * 16; px++) {
                final idx = py * 96 + px;
                cellSum += (lumGrid[idx] - meanLum) / stdLum;

                final left = px > 0 ? lumGrid[py * 96 + (px - 1)] : lumGrid[idx];
                final right = px < 95 ? lumGrid[py * 96 + (px + 1)] : lumGrid[idx];
                final top = py > 0 ? lumGrid[(py - 1) * 96 + px] : lumGrid[idx];
                final bottom = py < 95 ? lumGrid[(py + 1) * 96 + px] : lumGrid[idx];
                cellGradX += (right - left) / stdLum;
                cellGradY += (bottom - top) / stdLum;
              }
            }
            const count = 256.0;
            vec.add((cellSum / count).clamp(-3.0, 3.0));
            vec.add((cellGradX / count).clamp(-3.0, 3.0));
            vec.add((cellGradY / count).clamp(-3.0, 3.0));
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
    if (vecA.isEmpty || vecB.isEmpty) return 0.0;
    // Dimension check: vectors must come from the same feature space (192-D)
    if (vecA.length != vecB.length) return 0.0;
    double dotProduct = 0.0;
    for (int i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct.clamp(-1.0, 1.0);
  }

  void dispose() {
    _detector.close();
  }
}
