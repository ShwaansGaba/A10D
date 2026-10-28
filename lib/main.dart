import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'screens/face_scanner_screen.dart';
import 'screens/login_screen.dart';
import 'services/supabase_sync_service.dart';

List<CameraDescription> _cameras = <CameraDescription>[];

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock orientation to portrait for kiosk / handheld punch-in reliability
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Initialize Supabase realtime sync & check session
  await SupabaseSyncService().initialize();

  try {
    _cameras = await availableCameras();
  } on CameraException catch (e) {
    debugPrint('Error retrieving available cameras: $e');
  }

  runApp(FaceAttendanceApp(cameras: _cameras));
}

class FaceAttendanceApp extends StatelessWidget {
  final List<CameraDescription> cameras;

  const FaceAttendanceApp({super.key, required this.cameras});

  @override
  Widget build(BuildContext context) {
    final isLoggedIn = SupabaseSyncService().isUserLoggedIn;

    return MaterialApp(
      title: 'Face Attendance',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: Colors.black,
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF1D4ED8),
          secondary: Colors.cyanAccent,
          surface: Color(0xFF131D33),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.transparent,
          elevation: 0,
        ),
        useMaterial3: true,
      ),
      home: isLoggedIn
          ? FaceScannerScreen(cameras: cameras)
          : LoginScreen(cameras: cameras),
    );
  }
}
