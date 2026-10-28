import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/supabase_sync_service.dart';
import 'face_scanner_screen.dart';

class LoginScreen extends StatefulWidget {
  final List<CameraDescription> cameras;

  const LoginScreen({super.key, required this.cameras});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _deviceNameController = TextEditingController(text: 'Android Kiosk Terminal');

  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _errorMessage;

  static const String _signUpPortalUrl = 'https://shwaansgaba.github.io/A10D/';

  @override
  void initState() {
    super.initState();
    _loadSavedDeviceName();
  }

  Future<void> _loadSavedDeviceName() async {
    final name = await SupabaseSyncService().getDeviceName();
    if (mounted) {
      setState(() {
        _deviceNameController.text = name;
      });
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _deviceNameController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    final deviceName = _deviceNameController.text.trim();

    if (email.isEmpty || !email.contains('@')) {
      setState(() => _errorMessage = 'Please enter a valid work email address');
      return;
    }
    if (password.isEmpty) {
      setState(() => _errorMessage = 'Please enter your workspace password');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final response = await Supabase.instance.client.auth.signInWithPassword(
        email: email,
        password: password,
      );

      if (response.user == null) {
        throw const AuthException('Invalid login credentials');
      }

      // Register kiosk active in Supabase & reconcile offline records
      await SupabaseSyncService().registerKioskOnline(
        deviceName.isNotEmpty ? deviceName : 'Android Kiosk Terminal',
      );
      SupabaseSyncService().onUserLoggedIn();

      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => FaceScannerScreen(cameras: widget.cameras),
        ),
      );
    } on AuthException catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.message;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Connection error: $e';
        });
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _launchSignUpSite() async {
    final uri = Uri.parse(_signUpPortalUrl);
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw 'Could not launch $_signUpPortalUrl';
      }
    } catch (_) {
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          title: const Text('Sign Up Online', style: TextStyle(color: Colors.white)),
          content: const SelectableText(
            'To register your workspace, visit:\nhttps://shwaansgaba.github.io/A10D/',
            style: TextStyle(color: Colors.cyanAccent),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('OK', style: TextStyle(color: Colors.white70)),
            ),
          ],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    const royalBlue = Color(0xFF1D4ED8);
    const deepNavy = Color(0xFF0A0F1D);
    const cardBg = Color(0xFF131D33);

    return Scaffold(
      backgroundColor: deepNavy,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28.0, vertical: 24.0),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // App Icon in Royal Blue Ring
                  Center(
                    child: Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: const Color(0xFF1E3A8A).withValues(alpha: 0.4),
                        border: Border.all(color: royalBlue, width: 2),
                        boxShadow: [
                          BoxShadow(
                            color: royalBlue.withValues(alpha: 0.35),
                            blurRadius: 24,
                            spreadRadius: 2,
                          ),
                        ],
                      ),
                      child: const Icon(
                        Icons.face_retouching_natural,
                        size: 44,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Brand Headings
                  const Text(
                    'A10D',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Connect this terminal to your company workspace',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.blue.shade200.withValues(alpha: 0.85),
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 32),

                  // Card Form
                  Container(
                    padding: const EdgeInsets.all(24.0),
                    decoration: BoxDecoration(
                      color: cardBg,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: Colors.blue.shade900.withValues(alpha: 0.5)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.4),
                          blurRadius: 18,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (_errorMessage != null) ...[
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            decoration: BoxDecoration(
                              color: Colors.redAccent.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.redAccent.withValues(alpha: 0.35)),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.error_outline, color: Colors.redAccent, size: 18),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    _errorMessage!,
                                    style: const TextStyle(color: Colors.redAccent, fontSize: 12),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 18),
                        ],

                        // Email Field
                        const Text(
                          'Organization Email',
                          style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 6),
                        TextField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                          decoration: InputDecoration(
                            prefixIcon: const Icon(Icons.email_outlined, color: Colors.blueAccent, size: 20),
                            hintText: 'admin@company.com',
                            hintStyle: const TextStyle(color: Colors.white30, fontSize: 13),
                            filled: true,
                            fillColor: const Color(0xFF0B1324),
                            contentPadding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide(color: Colors.blue.shade900),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide(color: Colors.blue.shade900.withValues(alpha: 0.4)),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: const BorderSide(color: royalBlue, width: 2),
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),

                        // Password Field
                        const Text(
                          'Password',
                          style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 6),
                        TextField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                          decoration: InputDecoration(
                            prefixIcon: const Icon(Icons.lock_outline, color: Colors.blueAccent, size: 20),
                            suffixIcon: IconButton(
                              icon: Icon(
                                _obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                                color: Colors.white54,
                                size: 20,
                              ),
                              onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                            ),
                            hintText: '••••••••',
                            hintStyle: const TextStyle(color: Colors.white30, fontSize: 13),
                            filled: true,
                            fillColor: const Color(0xFF0B1324),
                            contentPadding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide(color: Colors.blue.shade900),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide(color: Colors.blue.shade900.withValues(alpha: 0.4)),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: const BorderSide(color: royalBlue, width: 2),
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),

                        // Kiosk Device Name
                        const Text(
                          'Kiosk Terminal Name',
                          style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 6),
                        TextField(
                          controller: _deviceNameController,
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                          decoration: InputDecoration(
                            prefixIcon: const Icon(Icons.smartphone_outlined, color: Colors.blueAccent, size: 20),
                            hintText: 'e.g. Front Gate Terminal',
                            hintStyle: const TextStyle(color: Colors.white30, fontSize: 13),
                            filled: true,
                            fillColor: const Color(0xFF0B1324),
                            contentPadding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide(color: Colors.blue.shade900),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide(color: Colors.blue.shade900.withValues(alpha: 0.4)),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: const BorderSide(color: royalBlue, width: 2),
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),

                        // Submit Button
                        ElevatedButton(
                          onPressed: _isLoading ? null : _handleLogin,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: royalBlue,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 15),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                            elevation: 4,
                            shadowColor: royalBlue.withValues(alpha: 0.5),
                          ),
                          child: _isLoading
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                                  ),
                                )
                              : const Text(
                                  'CONNECT KIOSK TERMINAL',
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),

                  // "Not a user? Sign up here" Redirect Link
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text(
                        'Not a user? ',
                        style: TextStyle(color: Colors.white60, fontSize: 13),
                      ),
                      GestureDetector(
                        onTap: _launchSignUpSite,
                        child: const Text(
                          'Sign Up Here',
                          style: TextStyle(
                            color: Colors.blueAccent,
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            decoration: TextDecoration.underline,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
