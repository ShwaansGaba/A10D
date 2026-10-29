import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/registered_user.dart';
import '../services/face_recognition_service.dart';
import '../services/supabase_sync_service.dart';
import '../widgets/face_overlay_painter.dart';

class RegisterFaceScreen extends StatefulWidget {
  final List<CameraDescription> cameras;

  const RegisterFaceScreen({super.key, required this.cameras});

  @override
  State<RegisterFaceScreen> createState() => _RegisterFaceScreenState();
}

class _RegisterFaceScreenState extends State<RegisterFaceScreen>
    with SingleTickerProviderStateMixin {
  CameraController? _cameraController;
  int _selectedCameraIndex = -1;
  bool _isCameraInitialized = false;
  bool _isProcessing = false;
  late AnimationController _animationController;

  // 3-View Multi-Angle Registration
  int _currentStep = 0; // 0: Front, 1: Left Angle, 2: Right Angle
  final List<List<double>> _capturedEmbeddings = [];
  String? _mainPhotoPath;
  String? _mainCroppedPath;

  static const List<Map<String, String>> _stepsMeta = [
    {
      'title': 'Front View',
      'instruction': 'Look straight directly into the camera',
    },
    {
      'title': 'Left Angle',
      'instruction': 'Turn your head slightly to the left',
    },
    {
      'title': 'Right Angle',
      'instruction': 'Turn your head slightly to the right',
    },
  ];

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat(reverse: true);

    _initCamera();
  }

  @override
  void dispose() {
    _animationController.dispose();
    _cameraController?.dispose();
    _cameraController = null;
    super.dispose();
  }

  Future<void> _initCamera() async {
    final status = await Permission.camera.request();
    if (!status.isGranted || widget.cameras.isEmpty) return;

    int index = widget.cameras.indexWhere(
      (c) => c.lensDirection == CameraLensDirection.front,
    );
    if (index == -1) index = 0;

    await _initController(index);
  }

  Future<void> _initController(int index) async {
    if (_cameraController != null) {
      await _cameraController!.dispose();
      _cameraController = null;
    }

    final controller = CameraController(
      widget.cameras[index],
      ResolutionPreset.medium,
      enableAudio: false,
      imageFormatGroup: ImageFormatGroup.jpeg,
    );

    try {
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _selectedCameraIndex = index;
        _cameraController = controller;
        _isCameraInitialized = true;
      });
    } catch (e) {
      debugPrint('Error starting camera for registration: $e');
    }
  }

  Future<void> _captureCurrentView() async {
    if (_isProcessing ||
        _cameraController == null ||
        !_cameraController!.value.isInitialized) {
      return;
    }

    setState(() {
      _isProcessing = true;
    });

    try {
      final photo = await _cameraController!.takePicture();
      final extraction = await FaceRecognitionService().extractFaceEmbedding(
        photo.path,
        generateCrop: (_currentStep == 0),
      );

      if (!mounted) return;

      if (extraction == null) {
        await showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFF221618),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(18),
              side: const BorderSide(color: Colors.redAccent, width: 1.2),
            ),
            title: const Row(
              children: [
                Icon(Icons.error_outline_rounded, color: Colors.redAccent, size: 26),
                SizedBox(width: 8),
                Text('No Face Detected', style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold)),
              ],
            ),
            content: Text(
              'Could not clearly detect face for ${_stepsMeta[_currentStep]['title']}.\nPlease adjust lighting, look towards the indicated angle, and try again.',
              style: const TextStyle(color: Colors.white70, fontSize: 13),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('Try Again', style: TextStyle(color: Colors.cyanAccent)),
              ),
            ],
          ),
        );
        return;
      }

      // Record embedding for this angle
      _capturedEmbeddings.add(extraction.embedding);
      if (_currentStep == 0) {
        _mainPhotoPath = photo.path;
        _mainCroppedPath = extraction.croppedPath;
      }

      if (_capturedEmbeddings.length < 3) {
        setState(() {
          _currentStep++;
        });

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle_rounded, color: Colors.greenAccent, size: 20),
                const SizedBox(width: 8),
                Text('${_stepsMeta[_currentStep - 1]['title']} saved! Now capture ${_stepsMeta[_currentStep]['title']}.'),
              ],
            ),
            backgroundColor: const Color(0xFF142419),
            duration: const Duration(seconds: 2),
          ),
        );
      } else {
        await _promptForEmployeeName();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.redAccent),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isProcessing = false;
        });
      }
    }
  }

  Future<void> _promptForEmployeeName() async {
    final nameController = TextEditingController();
    final phoneController = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF161A20),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
            top: 24,
            left: 24,
            right: 24,
          ),
          child: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: Colors.greenAccent.withValues(alpha: 0.18),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.verified_user_rounded, color: Colors.greenAccent),
                    ),
                    const SizedBox(width: 12),
                    const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '3 Views Captured!',
                          style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                        ),
                        Text(
                          'High-confidence profile ready',
                          style: TextStyle(color: Colors.white54, fontSize: 12),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 18),

                if (_mainCroppedPath != null && File(_mainCroppedPath!).existsSync())
                  Center(
                    child: Container(
                      width: 100,
                      height: 100,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.greenAccent, width: 3),
                        image: DecorationImage(
                          image: FileImage(File(_mainCroppedPath!)),
                          fit: BoxFit.cover,
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: 16),

                const Text(
                  'Employee / Person Name',
                  style: TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                TextFormField(
                  controller: nameController,
                  autofocus: true,
                  style: const TextStyle(color: Colors.white, fontSize: 16),
                  decoration: InputDecoration(
                    hintText: 'Enter full name',
                    hintStyle: const TextStyle(color: Colors.white30),
                    filled: true,
                    fillColor: Colors.black26,
                    prefixIcon: const Icon(Icons.person_outline, color: Colors.cyanAccent),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: Colors.white24),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: Colors.cyanAccent, width: 1.5),
                    ),
                  ),
                  validator: (val) {
                    if (val == null || val.trim().isEmpty) {
                      return 'Please enter a name';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 14),

                const Text(
                  'Phone Number',
                  style: TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                TextFormField(
                  controller: phoneController,
                  keyboardType: TextInputType.phone,
                  style: const TextStyle(color: Colors.white, fontSize: 16),
                  decoration: InputDecoration(
                    hintText: 'e.g. +91 98765 43210',
                    hintStyle: const TextStyle(color: Colors.white30),
                    filled: true,
                    fillColor: Colors.black26,
                    prefixIcon: const Icon(Icons.phone_outlined, color: Colors.cyanAccent),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: Colors.white24),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: Colors.cyanAccent, width: 1.5),
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.greenAccent[400],
                      foregroundColor: Colors.black,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    onPressed: () {
                      if (formKey.currentState!.validate()) {
                        Navigator.of(ctx).pop(true);
                      }
                    },
                    child: const Text('Save Employee Profile', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );

    if (confirmed == true && nameController.text.trim().isNotEmpty) {
      final RegisteredUser user = await FaceRecognitionService().registerUserMultiView(
        name: nameController.text.trim(),
        phone: phoneController.text.trim().isNotEmpty ? phoneController.text.trim() : null,
        mainPhotoPath: _mainPhotoPath ?? '',
        embeddings: _capturedEmbeddings,
        croppedPhotoPath: _mainCroppedPath,
      );

      // Sync employee profile and 3-view biometric data to Supabase
      await SupabaseSyncService().syncEmployee(user);

      // Cleanly dispose camera before returning to FaceScannerScreen
      await _cameraController?.dispose();
      _cameraController = null;

      if (!mounted) return;
      Navigator.of(context).pop(user);
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentMeta = _stepsMeta[_currentStep];
    final isFrontCamera = widget.cameras.isNotEmpty &&
        _selectedCameraIndex >= 0 &&
        widget.cameras[_selectedCameraIndex].lensDirection == CameraLensDirection.front;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white),
          onPressed: () async {
            await _cameraController?.dispose();
            _cameraController = null;
            if (context.mounted) Navigator.of(context).pop();
          },
        ),
        title: Text(
          'Register Face (${_currentStep + 1}/3)',
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18),
        ),
      ),
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            // Camera feed
            if (_isCameraInitialized && _cameraController != null)
              Center(
                child: Transform(
                  alignment: Alignment.center,
                  transform: Matrix4.identity()..scale(isFrontCamera ? -1.0 : 1.0, 1.0, 1.0),
                  child: CameraPreview(_cameraController!),
                ),
              )
            else
              const Center(
                child: CircularProgressIndicator(color: Colors.cyanAccent),
              ),

            // Oval Guide Overlay
            CustomPaint(
              size: Size.infinite,
              painter: FaceOverlayPainter(
                animationValue: _animationController.value,
                isScanning: !_isProcessing,
              ),
            ),

            // Top Multi-Step Progress Indicator
            Positioned(
              top: 10,
              left: 20,
              right: 20,
              child: Column(
                children: [
                  Row(
                    children: List.generate(3, (index) {
                      final isDone = index < _currentStep;
                      final isCurrent = index == _currentStep;
                      return Expanded(
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: 4),
                          height: 6,
                          decoration: BoxDecoration(
                            color: isDone
                                ? Colors.greenAccent
                                : (isCurrent ? Colors.cyanAccent : Colors.white24),
                            borderRadius: BorderRadius.circular(3),
                          ),
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.cyanAccent.withValues(alpha: 0.3)),
                    ),
                    child: Column(
                      children: [
                        Text(
                          currentMeta['title']!,
                          style: const TextStyle(
                            color: Colors.cyanAccent,
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          currentMeta['instruction']!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Bottom Capture Button
            Positioned(
              bottom: 28,
              left: 24,
              right: 24,
              child: SizedBox(
                height: 56,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.cyanAccent,
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    elevation: 5,
                  ),
                  onPressed: (_isCameraInitialized && !_isProcessing)
                      ? _captureCurrentView
                      : null,
                  icon: _isProcessing
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
                        )
                      : const Icon(Icons.camera_alt_rounded, size: 24),
                  label: Text(
                    _isProcessing
                        ? 'Analyzing ${currentMeta['title']}...'
                        : 'Capture ${currentMeta['title']} (${_currentStep + 1}/3)',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
