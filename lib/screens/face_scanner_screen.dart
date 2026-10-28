import 'dart:async';
import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import '../models/registered_user.dart';
import '../services/audio_feedback_service.dart';
import '../services/face_recognition_service.dart';
import '../services/supabase_sync_service.dart';
import '../widgets/face_overlay_painter.dart';
import 'login_screen.dart';
import 'register_face_screen.dart';

class FaceScannerScreen extends StatefulWidget {
  final List<CameraDescription> cameras;

  const FaceScannerScreen({super.key, required this.cameras});

  @override
  State<FaceScannerScreen> createState() => _FaceScannerScreenState();
}

class _FaceScannerScreenState extends State<FaceScannerScreen>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  CameraController? _cameraController;
  int _selectedCameraIndex = -1;
  bool _isCameraInitialized = false;
  bool _isPermissionDenied = false;

  // Live recognition & anti-spoofing state
  bool _isProcessingFrame = false;
  Timer? _liveScanTimer;
  RegisteredUser? _recognizedUser;
  bool _isLivenessPassed = false;
  String? _livenessHint;
  PunchStatus? _lastPunchStatus;
  DateTime? _lastRecognizedTime;

  // Kiosk Inactivity Dimming State
  DateTime _lastFaceActivityTime = DateTime.now();
  bool _isKioskDimmed = false;

  late AnimationController _scannerAnimationController;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    // Keep screen awake 24/7 for kiosk duty
    WakelockPlus.enable();

    // Initialize audio & TTS engine
    AudioFeedbackService().initialize();

    _scannerAnimationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat(reverse: true);

    // Clean old temporary frame caches on startup
    FaceRecognitionService().cleanCache();

    _initializeCamera();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _liveScanTimer?.cancel();
    _scannerAnimationController.dispose();
    _cameraController?.dispose();
    _cameraController = null;
    WakelockPlus.disable();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      _stopLiveScanLoop();
      _cameraController?.dispose();
      _cameraController = null;
      if (mounted) {
        setState(() {
          _isCameraInitialized = false;
        });
      }
    } else if (state == AppLifecycleState.resumed) {
      SupabaseSyncService().syncAllFromRemote();
      _initializeCamera();
    }
  }

  Future<void> _initializeCamera() async {
    final status = await Permission.camera.request();
    if (!status.isGranted) {
      if (mounted) {
        setState(() {
          _isPermissionDenied = true;
          _isCameraInitialized = false;
        });
      }
      return;
    }

    if (mounted) {
      setState(() {
        _isPermissionDenied = false;
      });
    }

    if (widget.cameras.isEmpty) return;

    // Use front selfie camera
    int targetIndex = widget.cameras.indexWhere(
      (c) => c.lensDirection == CameraLensDirection.front,
    );
    if (targetIndex == -1) targetIndex = 0;

    if (_cameraController != null) {
      await _cameraController!.dispose();
      _cameraController = null;
    }

    final controller = CameraController(
      widget.cameras[targetIndex],
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
        _selectedCameraIndex = targetIndex;
        _cameraController = controller;
        _isCameraInitialized = true;
      });

      _startLiveScanLoop();
    } catch (e) {
      debugPrint('Error initializing camera: $e');
    }
  }

  void _startLiveScanLoop() {
    _liveScanTimer?.cancel();
    // Scan every 400ms for instant real-time response
    _liveScanTimer = Timer.periodic(const Duration(milliseconds: 400), (_) {
      _processLiveFrame();
    });
  }

  void _stopLiveScanLoop() {
    _liveScanTimer?.cancel();
    _liveScanTimer = null;
  }

  Future<void> _processLiveFrame() async {
    if (_isProcessingFrame ||
        _cameraController == null ||
        !_cameraController!.value.isInitialized ||
        !mounted) {
      return;
    }

    final now = DateTime.now();

    // Kiosk Auto-Dimming Logic: Dim after 20s of no face activity
    if (now.difference(_lastFaceActivityTime).inSeconds >= 20) {
      if (!_isKioskDimmed && mounted) {
        setState(() {
          _isKioskDimmed = true;
        });
      }
    }

    _isProcessingFrame = true;
    String? tempPath;

    try {
      final XFile image = await _cameraController!.takePicture();
      tempPath = image.path;

      // Ultra-fast biometric matching & liveness check
      final result =
          await FaceRecognitionService().recognizeFaceFast(tempPath);

      if (!mounted) return;

      if (result.isPersonDetected) {
        _lastFaceActivityTime = now;
        if (_isKioskDimmed) {
          setState(() {
            _isKioskDimmed = false; // Wake up immediately on face presence
          });
        }
      }

      if (result.isRecognized && result.user != null) {
        final user = result.user!;

        // Check Anti-Spoofing (Blink or Head Motion)
        if (!result.isLivenessVerified) {
          // Face recognized, but awaiting genuine blink/motion
          setState(() {
            _recognizedUser = user;
            _isLivenessPassed = false;
            _livenessHint = result.livenessReason ?? 'Blink or turn slightly';
          });
          return;
        }

        // Liveness passed! Proceed to Single-Punch-Per-Day evaluation
        final punchStatus = await SupabaseSyncService().recordAttendanceLog(
          employeeName: user.name,
          employeeId: user.id,
          confidence: result.confidence,
        );

        if (mounted) {
          setState(() {
            _recognizedUser = user;
            _isLivenessPassed = true;
            _livenessHint = null;
            _lastPunchStatus = punchStatus;
            _lastRecognizedTime = DateTime.now();
          });
        }

        // Play pleasant chime & announcement only on fresh punch
        if (punchStatus == PunchStatus.success || punchStatus == PunchStatus.queuedOffline) {
          AudioFeedbackService().playChime();
          AudioFeedbackService().announceWelcome(user.name);
        }
      } else {
        if (_recognizedUser != null) {
          setState(() {
            _recognizedUser = null;
            _isLivenessPassed = false;
            _livenessHint = null;
            _lastPunchStatus = null;
          });
        }
      }
    } catch (e) {
      debugPrint('Live frame error: $e');
    } finally {
      if (tempPath != null) {
        try {
          final f = File(tempPath);
          if (await f.exists()) await f.delete();
        } catch (_) {}
      }
      _isProcessingFrame = false;
    }
  }

  void _wakeKiosk() {
    _lastFaceActivityTime = DateTime.now();
    if (_isKioskDimmed) {
      setState(() {
        _isKioskDimmed = false;
      });
    }
  }

  Future<void> _navigateToRegister() async {
    _wakeKiosk();
    _stopLiveScanLoop();
    if (_cameraController != null) {
      await _cameraController!.dispose();
      _cameraController = null;
      if (mounted) {
        setState(() {
          _isCameraInitialized = false;
        });
      }
    }

    if (!mounted) return;

    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (ctx) => RegisterFaceScreen(cameras: widget.cameras),
      ),
    );
    await SupabaseSyncService().syncAllFromRemote();

    await FaceRecognitionService().cleanCache();
    if (mounted) {
      await _initializeCamera();
    }
  }

  /// Direct Full System Reset with Safety Confirmation
  Future<void> _promptAdminReset() async {
    _wakeKiosk();
    if (!mounted) return;

    // Safety confirmation dialog
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1417),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.warning_amber_rounded, color: Colors.redAccent),
              SizedBox(width: 8),
              Text('Reset Everything?', style: TextStyle(color: Colors.white, fontSize: 18)),
            ],
          ),
          content: const Text(
            'This action will permanently delete:\n\n'
            '• All registered employee facial profiles & embeddings\n'
            '• All attendance logs & punches (locally & on Supabase)\n'
            '• Offline queued punches & today\'s punch tracking\n\n'
            'Are you sure you want to completely reset?',
            style: TextStyle(color: Colors.white70, fontSize: 13, height: 1.4),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.redAccent,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Yes, Reset All', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );

    if (confirm != true || !mounted) return;

    // Perform complete reset
    try {
      await FaceRecognitionService().resetAllFaceData();
      await SupabaseSyncService().resetAllAttendanceData(resetRemoteSupabase: true);

      if (mounted) {
        setState(() {
          _recognizedUser = null;
          _lastPunchStatus = null;
          _isLivenessPassed = false;
        });

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('All facial data and attendance records have been reset.'),
            backgroundColor: Colors.redAccent,
            duration: Duration(seconds: 4),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Reset encountered an issue: $e'),
            backgroundColor: Colors.amber,
          ),
        );
      }
    }
  }

  /// Kiosk Sign Out / Disconnect from Workspace
  Future<void> _promptKioskLogout() async {
    _wakeKiosk();
    final email = SupabaseSyncService().currentUserEmail ?? 'your workspace';
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF131D33),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: Color(0xFF1D4ED8), width: 1.2),
        ),
        title: const Row(
          children: [
            Icon(Icons.power_settings_new_rounded, color: Colors.blueAccent, size: 24),
            SizedBox(width: 10),
            Text(
              'Sign Out Kiosk',
              style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        content: Text(
          'Disconnect this device from $email?\n\nThis terminal will stop reporting attendance and will immediately show as OFFLINE in your web dashboard.',
          style: const TextStyle(color: Colors.white70, fontSize: 13, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Sign Out', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirm == true && mounted) {
      _stopLiveScanLoop();
      await SupabaseSyncService().logout();
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => LoginScreen(cameras: widget.cameras),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isPersonRecognized = _recognizedUser != null;
    final isFrontCamera = widget.cameras.isNotEmpty &&
        _selectedCameraIndex >= 0 &&
        widget.cameras[_selectedCameraIndex].lensDirection == CameraLensDirection.front;

    // Border color: Green on successful punch, Cyan on already punched, or default
    final Color reticleColor = isPersonRecognized
        ? (_isLivenessPassed
            ? (_lastPunchStatus == PunchStatus.alreadyPunchedToday
                ? const Color(0xFF00E5FF)
                : const Color(0xFF00E676))
            : Colors.amberAccent)
        : Colors.cyanAccent.withValues(alpha: 0.65);

    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        onTap: _wakeKiosk,
        child: SafeArea(
          child: Stack(
            fit: StackFit.expand,
            children: [
              // 1. Live Camera Preview
              if (_isCameraInitialized && _cameraController != null)
                Center(
                  child: Transform(
                    alignment: Alignment.center,
                    transform: Matrix4.identity()..scale(isFrontCamera ? -1.0 : 1.0, 1.0, 1.0),
                    child: CameraPreview(_cameraController!),
                  ),
                )
              else if (_isPermissionDenied)
                Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.videocam_off_rounded, size: 64, color: Colors.redAccent),
                      const SizedBox(height: 14),
                      const Text('Camera Permission Required', style: TextStyle(color: Colors.white, fontSize: 18)),
                      const SizedBox(height: 14),
                      ElevatedButton(
                        onPressed: _initializeCamera,
                        child: const Text('Grant Permission'),
                      ),
                    ],
                  ),
                )
              else
                const Center(
                  child: CircularProgressIndicator(color: Colors.cyanAccent),
                ),

              // 2. Oval Face Detector
              AnimatedBuilder(
                animation: _scannerAnimationController,
                builder: (context, child) {
                  return CustomPaint(
                    size: Size.infinite,
                    painter: FaceOverlayPainter(
                      animationValue: _scannerAnimationController.value,
                      isScanning: _isCameraInitialized && !_isKioskDimmed,
                      borderColor: reticleColor,
                      cornerColor: reticleColor,
                    ),
                  );
                },
              ),

              // 3. Top-Left "+" Icon to Register New Face
              Positioned(
                top: 14,
                left: 14,
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: _navigateToRegister,
                    borderRadius: BorderRadius.circular(24),
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.45),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white24, width: 1),
                      ),
                      child: const Icon(
                        Icons.add_rounded,
                        color: Colors.white,
                        size: 26,
                      ),
                    ),
                  ),
                ),
              ),

              // 3b. Top-Left Reset Icon to Wipe Logs & Faces
              Positioned(
                top: 14,
                left: 68,
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: _promptAdminReset,
                    borderRadius: BorderRadius.circular(24),
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.redAccent.withValues(alpha: 0.2),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.redAccent.withValues(alpha: 0.5), width: 1),
                      ),
                      child: const Icon(
                        Icons.restart_alt_rounded,
                        color: Colors.redAccent,
                        size: 26,
                      ),
                    ),
                  ),
                ),
              ),

              // 3c. Top-Left Kiosk Sign Out Icon
              Positioned(
                top: 14,
                left: 122,
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: _promptKioskLogout,
                    borderRadius: BorderRadius.circular(24),
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1D4ED8).withValues(alpha: 0.25),
                        shape: BoxShape.circle,
                        border: Border.all(color: const Color(0xFF1D4ED8).withValues(alpha: 0.6), width: 1),
                      ),
                      child: const Icon(
                        Icons.power_settings_new_rounded,
                        color: Colors.blueAccent,
                        size: 26,
                      ),
                    ),
                  ),
                ),
              ),

              // 4. Top-Right Offline Queue & Network Status Pill
              Positioned(
                top: 16,
                right: 16,
                child: ValueListenableBuilder<int>(
                  valueListenable: SupabaseSyncService().pendingOfflineQueueCount,
                  builder: (context, count, _) {
                    return ValueListenableBuilder<bool>(
                      valueListenable: SupabaseSyncService().isNetworkConnected,
                      builder: (context, isOnline, _) {
                        return Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.55),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: !isOnline || count > 0 ? Colors.amberAccent : Colors.greenAccent,
                              width: 1,
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 7,
                                height: 7,
                                decoration: BoxDecoration(
                                  color: !isOnline
                                      ? Colors.redAccent
                                      : (count > 0 ? Colors.amberAccent : Colors.greenAccent),
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                !isOnline
                                    ? (count > 0 ? 'Offline ($count queued)' : 'Offline')
                                    : (count > 0 ? 'Syncing ($count)' : 'Online'),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    );
                  },
                ),
              ),

              // 5. Liveness Guidance Chip (Shown when waiting for a blink/motion)
              if (isPersonRecognized && !_isLivenessPassed && _livenessHint != null)
                Positioned(
                  top: MediaQuery.of(context).size.height * 0.62,
                  left: 24,
                  right: 24,
                  child: Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2E2412).withValues(alpha: 0.95),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: Colors.amberAccent, width: 1.5),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.amberAccent.withValues(alpha: 0.2),
                            blurRadius: 12,
                          ),
                        ],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.remove_red_eye_outlined, color: Colors.amberAccent, size: 18),
                          const SizedBox(width: 8),
                          Text(
                            _livenessHint!,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

              // 6. Bottom Employee Attendance Confirmation Card
              Positioned(
                bottom: 36,
                left: 20,
                right: 20,
                child: AnimatedOpacity(
                  duration: const Duration(milliseconds: 200),
                  opacity: (isPersonRecognized && _isLivenessPassed) ? 1.0 : 0.0,
                  child: (isPersonRecognized && _isLivenessPassed)
                      ? _buildAttendanceCard()
                      : const SizedBox.shrink(),
                ),
              ),

              // 7. Kiosk Inactivity Dimmer Overlay (Energy saving & screen protection)
              AnimatedOpacity(
                duration: const Duration(milliseconds: 600),
                opacity: _isKioskDimmed ? 0.88 : 0.0,
                child: IgnorePointer(
                  ignoring: !_isKioskDimmed,
                  child: Container(
                    color: Colors.black,
                    child: const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.fingerprint_rounded, size: 48, color: Colors.cyanAccent),
                          SizedBox(height: 12),
                          Text(
                            'Kiosk Idle',
                            style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'Step in front of camera or tap to wake',
                            style: TextStyle(color: Colors.white54, fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAttendanceCard() {
    final isAlreadyPunched = _lastPunchStatus == PunchStatus.alreadyPunchedToday;
    final isQueuedOffline = _lastPunchStatus == PunchStatus.queuedOffline;
    final timeStr = _lastRecognizedTime != null
        ? DateFormat('hh:mm:ss a').format(_lastRecognizedTime!)
        : DateFormat('hh:mm:ss a').format(DateTime.now());

    final cardBg = isAlreadyPunched
        ? const Color(0xFF0F2328).withValues(alpha: 0.94)
        : const Color(0xFF102816).withValues(alpha: 0.94);

    final borderColor = isAlreadyPunched
        ? const Color(0xFF00E5FF)
        : const Color(0xFF00E676);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: borderColor, width: 2),
        boxShadow: [
          BoxShadow(
            color: borderColor.withValues(alpha: 0.3),
            blurRadius: 18,
            spreadRadius: 2,
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: borderColor,
              shape: BoxShape.circle,
            ),
            child: Icon(
              isAlreadyPunched ? Icons.done_all_rounded : Icons.check_rounded,
              color: Colors.black,
              size: 22,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _recognizedUser!.name,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.3,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  isAlreadyPunched
                      ? 'Already Punched Today • No Re-punch Needed'
                      : (isQueuedOffline
                          ? 'Punched In (Offline Queued) • $timeStr'
                          : 'Punched In (Live Synced) • $timeStr'),
                  style: TextStyle(
                    color: isAlreadyPunched ? const Color(0xFF84FFFF) : const Color(0xFFB9F6CA),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
