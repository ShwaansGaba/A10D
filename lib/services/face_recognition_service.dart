import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/registered_user.dart';

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

  static const String _usersKey = 'registered_attendance_faces_v3';
  // Cosine similarity threshold for biometric geometric matching
  static const double matchThreshold = 0.70;

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

  /// Live-sync local face cache with remote employees from Supabase
  Future<void> syncFromRemoteEmployees(List<Map<String, dynamic>> remoteEmployees) async {
    final prefs = await SharedPreferences.getInstance();
    final localUsers = await getRegisteredUsers();

    if (remoteEmployees.isEmpty) {
      if (localUsers.isNotEmpty) {
        debugPrint('Remote employee list is empty. Clearing all local face data.');
        await resetAllFaceData();
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

    // 1. Remove any local users who no longer exist on remote
    final updatedList = <RegisteredUser>[];
    for (final user in localUsers) {
      final matchesName = remoteNames.contains(user.name.trim().toLowerCase());
      final matchesId = remoteIds.contains(user.id);
      if (matchesName || matchesId) {
        updatedList.add(user);
      } else {
        debugPrint('Removing locally cached face for removed employee: ${user.name}');
        try {
          final file = File(user.photoPath);
          if (await file.exists()) {
            await file.delete();
          }
        } catch (_) {}
      }
    }

    // 2. Add any remote employees that have embeddings and are missing locally
    for (final emp in remoteEmployees) {
      final name = emp['name'] as String?;
      if (name == null || name.trim().isEmpty) continue;
      final empId = emp['id']?.toString() ?? DateTime.now().millisecondsSinceEpoch.toString();
      final hasLocal = updatedList.any((u) => u.name.trim().toLowerCase() == name.trim().toLowerCase());

      if (!hasLocal && emp['embeddings'] != null) {
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

        if (parsedEmbeddings.isNotEmpty) {
          final newUser = RegisteredUser(
            id: empId,
            name: name.trim(),
            photoPath: emp['photo_url'] ?? '',
            registeredAt: emp['created_at'] != null ? DateTime.tryParse(emp['created_at']) ?? DateTime.now() : DateTime.now(),
            embeddings: parsedEmbeddings,
          );
          updatedList.add(newUser);
          debugPrint('Synced employee from remote into local face database: ${newUser.name}');
        }
      }
    }

    await prefs.setStringList(_usersKey, updatedList.map((u) => u.toJson()).toList());
    debugPrint('FaceRecognitionService: Local face database now has ${updatedList.length} enrolled users.');
  }

  /// High-speed biometric embedding extraction
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

    if (generateCrop) {
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
            final cropped = img.copyCrop(decoded, x: x, y: y, width: w, height: h);
            final tempDir = await getTemporaryDirectory();
            final cropFile = File(
              p.join(tempDir.path, 'crop_${DateTime.now().millisecondsSinceEpoch}.jpg'),
            );
            await cropFile.writeAsBytes(img.encodeJpg(cropped, quality: 80));
            croppedPath = cropFile.path;
          }
        }
      } catch (e) {
        debugPrint('Crop generation notice: $e');
      }
    }

    final geometricFeatures = _buildGeometricVector(primaryFace);
    final normalizedEmbedding = _l2Normalize(geometricFeatures);

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

    for (final candidate in registeredUsers) {
      for (final viewEmbedding in candidate.embeddings) {
        final similarity = _calculateCosineSimilarity(
          extraction.embedding,
          viewEmbedding,
        );

        if (similarity > highestScore) {
          highestScore = similarity;
          bestMatch = candidate;
        }
      }
    }

    if (highestScore >= matchThreshold && bestMatch != null) {
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

  List<double> _buildGeometricVector(Face face) {
    final box = face.boundingBox;
    final w = box.width.abs() > 0 ? box.width : 1.0;
    final h = box.height.abs() > 0 ? box.height : 1.0;

    final List<double> vec = [];

    // Face aspect ratio & head pose
    vec.add((w / h).clamp(0.2, 4.0));
    vec.add(((face.headEulerAngleY ?? 0.0) / 90.0).clamp(-1.0, 1.0));
    vec.add(((face.headEulerAngleZ ?? 0.0) / 90.0).clamp(-1.0, 1.0));

    // Normalized landmark points
    final landmarks = [
      face.landmarks[FaceLandmarkType.leftEye],
      face.landmarks[FaceLandmarkType.rightEye],
      face.landmarks[FaceLandmarkType.noseBase],
      face.landmarks[FaceLandmarkType.leftMouth],
      face.landmarks[FaceLandmarkType.rightMouth],
      face.landmarks[FaceLandmarkType.bottomMouth],
      face.landmarks[FaceLandmarkType.leftCheek],
      face.landmarks[FaceLandmarkType.rightCheek],
      face.landmarks[FaceLandmarkType.leftEar],
      face.landmarks[FaceLandmarkType.rightEar],
    ];

    for (final lm in landmarks) {
      if (lm != null) {
        vec.add(((lm.position.x - box.left) / w).clamp(-0.5, 1.5));
        vec.add(((lm.position.y - box.top) / h).clamp(-0.5, 1.5));
      } else {
        vec.add(0.0);
        vec.add(0.0);
      }
    }

    // Relative landmark distances
    final leftEye = face.landmarks[FaceLandmarkType.leftEye]?.position;
    final rightEye = face.landmarks[FaceLandmarkType.rightEye]?.position;
    final nose = face.landmarks[FaceLandmarkType.noseBase]?.position;
    final bottomMouth = face.landmarks[FaceLandmarkType.bottomMouth]?.position;

    if (leftEye != null && rightEye != null) {
      final eyeDistance = math.sqrt(
        math.pow(rightEye.x - leftEye.x, 2) + math.pow(rightEye.y - leftEye.y, 2),
      );
      vec.add(eyeDistance / w);

      if (nose != null) {
        final eyeCenterX = (leftEye.x + rightEye.x) / 2.0;
        final eyeCenterY = (leftEye.y + rightEye.y) / 2.0;
        final eyeToNose = math.sqrt(
          math.pow(nose.x - eyeCenterX, 2) + math.pow(nose.y - eyeCenterY, 2),
        );
        vec.add(eyeToNose / h);
      } else {
        vec.add(0.0);
      }
    } else {
      vec.add(0.0);
      vec.add(0.0);
    }

    if (nose != null && bottomMouth != null) {
      final noseToMouth = math.sqrt(
        math.pow(bottomMouth.x - nose.x, 2) + math.pow(bottomMouth.y - nose.y, 2),
      );
      vec.add(noseToMouth / h);
    } else {
      vec.add(0.0);
    }

    // Sample points from the face contour
    final faceContour = face.contours[FaceContourType.face]?.points;
    if (faceContour != null && faceContour.isNotEmpty) {
      final step = math.max(1, faceContour.length ~/ 16);
      for (int i = 0; i < 16; i++) {
        final idx = (i * step) % faceContour.length;
        final pt = faceContour[idx];
        vec.add(((pt.x - box.left) / w).clamp(-0.5, 1.5));
        vec.add(((pt.y - box.top) / h).clamp(-0.5, 1.5));
      }
    } else {
      for (int i = 0; i < 32; i++) {
        vec.add(0.0);
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
