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

    final registeredUser = await Navigator.of(context).push<RegisteredUser?>(
      MaterialPageRoute(
        builder: (ctx) => RegisterFaceScreen(cameras: widget.cameras),
      ),
    );
    if (registeredUser != null) {
      await SupabaseSyncService().syncEmployee(registeredUser);
    }
    await SupabaseSyncService().syncAllFromRemote();

    await FaceRecognitionService().cleanCache();
    if (mounted) {
      await _initializeCamera();
    }
  }

  /// Displays the Workspace Account modal dialog on top-right tap
  Future<void> _showAccountDialog() async {
    _wakeKiosk();
    final email = SupabaseSyncService().currentUserEmail ?? 'Workspace Admin';
    final device = SupabaseSyncService().kioskDeviceName;
    final isOnline = SupabaseSyncService().isNetworkConnected.value;

    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF131D33),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: const BorderSide(color: Color(0xFF1D4ED8), width: 1.2),
        ),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xFF1D4ED8).withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.manage_accounts_rounded, color: Colors.blueAccent, size: 24),
            ),
            const SizedBox(width: 12),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'A10D Kiosk Account',
                  style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                ),
                Text(
                  'Enterprise Biometrics',
                  style: TextStyle(color: Colors.white54, fontSize: 11),
                ),
              ],
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.white12),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      const Icon(Icons.email_outlined, color: Colors.blueAccent, size: 16),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          email,
                          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.tablet_android_rounded, color: Colors.cyanAccent, size: 16),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          device,
                          style: const TextStyle(color: Colors.white70, fontSize: 12),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: isOnline ? Colors.green.withValues(alpha: 0.2) : Colors.red.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          isOnline ? 'ONLINE' : 'OFFLINE',
                          style: TextStyle(
                            color: isOnline ? Colors.greenAccent : Colors.redAccent,
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Manage registered faces, export CSV logs, and view your fleet analytics on the A10D web portal at shwaansgaba.github.io/A10D/',
              style: TextStyle(color: Colors.white54, fontSize: 11, height: 1.3),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Close', style: TextStyle(color: Colors.white70)),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent.withValues(alpha: 0.2),
              foregroundColor: Colors.redAccent,
              elevation: 0,
              side: const BorderSide(color: Colors.redAccent, width: 1),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: () {
              Navigator.of(ctx).pop();
              _promptKioskLogout();
            },
            icon: const Icon(Icons.power_settings_new_rounded, size: 16),
            label: const Text('Sign Out', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
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

              // 4. Top-Right: Network Status Pill & Account Button
              Positioned(
                top: 14,
                right: 14,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ValueListenableBuilder<int>(
                      valueListenable: SupabaseSyncService().pendingOfflineQueueCount,
                      builder: (context, count, _) {
                        return ValueListenableBuilder<bool>(
                          valueListenable: SupabaseSyncService().isNetworkConnected,
                          builder: (context, isOnline, _) {
                            return Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
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
                                    !isOnline ? 'OFFLINE' : (count > 0 ? 'SYNCING ($count)' : 'ONLINE'),
                                    style: TextStyle(
                                      color: !isOnline
                                          ? Colors.redAccent
                                          : (count > 0 ? Colors.amberAccent : Colors.greenAccent),
                                      fontSize: 10,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        );
                      },
                    ),
                    const SizedBox(width: 8),
                    // Top-Right Account Button
                    Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: _showAccountDialog,
                        borderRadius: BorderRadius.circular(24),
                        child: Container(
                          padding: const EdgeInsets.all(9),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1D4ED8).withValues(alpha: 0.35),
                            shape: BoxShape.circle,
                            border: Border.all(color: const Color(0xFF1D4ED8), width: 1.2),
                          ),
                          child: const Icon(
                            Icons.manage_accounts_rounded,
                            color: Colors.white,
                            size: 20,
                          ),
                        ),
                      ),
                    ),
                  ],
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
