import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_tts/flutter_tts.dart';

class AudioFeedbackService {
  static final AudioFeedbackService _instance =
      AudioFeedbackService._internal();
  factory AudioFeedbackService() => _instance;
  AudioFeedbackService._internal();

  final AudioPlayer _audioPlayer = AudioPlayer();
  final FlutterTts _tts = FlutterTts();
  bool _isTtsInitialized = false;

  Future<void> initialize() async {
    try {
      await _tts.setLanguage('en-US');
      await _tts.setPitch(1.05);
      await _tts.setSpeechRate(0.5);
      _isTtsInitialized = true;
    } catch (e) {
      debugPrint('TTS initialization notice: $e');
    }
  }

  /// Plays a pleasant modern 2-tone biometric confirmation chime
  Future<void> playChime() async {
    try {
      // Haptic confirmation
      HapticFeedback.mediumImpact();

      // Play synthesized pleasant high-pitch dual chime (880Hz -> 1320Hz)
      final chimeBytes = _generateChimeWav();
      await _audioPlayer.play(BytesSource(chimeBytes));
    } catch (e) {
      debugPrint('Chime audio fallback notice: $e');
      SystemSound.play(SystemSoundType.click);
    }
  }

  /// Optional friendly voice announcement: "Welcome, [Name]!"
  Future<void> announceWelcome(String name) async {
    if (!_isTtsInitialized) return;
    try {
      await _tts.stop();
      await _tts.speak('Welcome, $name');
    } catch (e) {
      debugPrint('TTS announcement notice: $e');
    }
  }

  /// Generates a pleasant synthesized WAV chime in memory (no asset files required)
  Uint8List _generateChimeWav() {
    const sampleRate = 22050;
    const duration = 0.35; // seconds
    final numSamples = (sampleRate * duration).toInt();
    final samples = Int16List(numSamples);

    for (int i = 0; i < numSamples; i++) {
      final t = i / sampleRate;
      // Soft harmonic chime: 880Hz (A5) shifting to 1320Hz (E6)
      final freq = t < 0.12 ? 880.0 : 1320.0;
      final envelope = (1.0 - (t / duration)).clamp(0.0, 1.0);
      final wave = 0.75 * envelope * 32767.0 * 0.4 *
          (1.0 * (t * freq * 2.0 * 3.14159265).sin() +
           0.25 * (t * freq * 4.0 * 3.14159265).sin());
      samples[i] = wave.toInt().clamp(-32768, 32767);
    }

    // Standard WAV Header
    final byteData = ByteData(44 + numSamples * 2);
    // "RIFF"
    byteData.setUint8(0, 0x52); byteData.setUint8(1, 0x49); byteData.setUint8(2, 0x46); byteData.setUint8(3, 0x46);
    byteData.setUint32(4, 36 + numSamples * 2, Endian.little);
    // "WAVE"
    byteData.setUint8(8, 0x57); byteData.setUint8(9, 0x41); byteData.setUint8(10, 0x56); byteData.setUint8(11, 0x45);
    // "fmt "
    byteData.setUint8(12, 0x66); byteData.setUint8(13, 0x6D); byteData.setUint8(14, 0x74); byteData.setUint8(15, 0x20);
    byteData.setUint32(16, 16, Endian.little); // PCM
    byteData.setUint16(20, 1, Endian.little);  // Mono
    byteData.setUint16(22, 1, Endian.little);  // 1 Channel
    byteData.setUint32(24, sampleRate, Endian.little);
    byteData.setUint32(28, sampleRate * 2, Endian.little); // Byte rate
    byteData.setUint16(32, 2, Endian.little);  // Block align
    byteData.setUint16(34, 16, Endian.little); // 16 bits per sample
    // "data"
    byteData.setUint8(36, 0x64); byteData.setUint8(37, 0x61); byteData.setUint8(38, 0x74); byteData.setUint8(39, 0x61);
    byteData.setUint32(40, numSamples * 2, Endian.little);

    for (int i = 0; i < numSamples; i++) {
      byteData.setInt16(44 + i * 2, samples[i], Endian.little);
    }

    return byteData.buffer.asUint8List();
  }
}

extension on double {
  double sin() => (this % (2 * 3.14159265)).sinApproximation();
  double sinApproximation() {
    double x = this;
    if (x > 3.14159265) x -= 2 * 3.14159265;
    return x - (x * x * x) / 6.0 + (x * x * x * x * x) / 120.0;
  }
}
