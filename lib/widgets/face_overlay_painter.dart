import 'package:flutter/material.dart';

/// Custom painter that creates a semi-transparent dark vignette with
/// an oval cutout guide and corner accent brackets for face positioning.
class FaceOverlayPainter extends CustomPainter {
  final double animationValue;
  final bool isScanning;
  final Color borderColor;
  final Color cornerColor;

  FaceOverlayPainter({
    required this.animationValue,
    this.isScanning = true,
    this.borderColor = const Color(0xFF18FFFF),
    this.cornerColor = Colors.white,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final backgroundPaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.65)
      ..style = PaintingStyle.fill;

    // Define the face scanning oval in the upper-center area
    final ovalWidth = size.width * 0.72;
    final ovalHeight = size.height * 0.44;
    final center = Offset(size.width / 2, size.height * 0.38);
    final ovalRect = Rect.fromCenter(
      center: center,
      width: ovalWidth,
      height: ovalHeight,
    );

    // Punch out the oval from the dark overlay
    final backgroundPath = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height));
    final ovalPath = Path()..addOval(ovalRect);
    final transparentHolePath = Path.combine(
      PathOperation.difference,
      backgroundPath,
      ovalPath,
    );

    canvas.drawPath(transparentHolePath, backgroundPaint);

    // Outer border ring for the face target
    final borderPaint = Paint()
      ..color = borderColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.5;

    canvas.drawOval(ovalRect, borderPaint);

    // Animated scanning line inside the oval
    if (isScanning) {
      final scanLineY =
          ovalRect.top + (ovalRect.height * animationValue);
      final scanLinePaint = Paint()
        ..shader = LinearGradient(
          colors: [
            Colors.transparent,
            borderColor.withValues(alpha: 0.9),
            borderColor,
            borderColor.withValues(alpha: 0.9),
            Colors.transparent,
          ],
        ).createShader(
          Rect.fromLTWH(ovalRect.left, scanLineY, ovalRect.width, 3),
        )
        ..strokeWidth = 2.5
        ..style = PaintingStyle.stroke;

      // Restrict the scan line within the oval bounds
      canvas.save();
      canvas.clipPath(ovalPath);
      canvas.drawLine(
        Offset(ovalRect.left, scanLineY),
        Offset(ovalRect.right, scanLineY),
        scanLinePaint,
      );
      canvas.restore();
    }

    // Corner guides around the face oval
    final cornerPaint = Paint()
      ..color = cornerColor
      ..strokeWidth = 4.0
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    const padding = 14.0;
    final bracketRect = ovalRect.inflate(padding);
    const bracketLen = 28.0;

    // Top-left bracket
    canvas.drawLine(
      Offset(bracketRect.left, bracketRect.top + bracketLen),
      Offset(bracketRect.left, bracketRect.top),
      cornerPaint,
    );
    canvas.drawLine(
      Offset(bracketRect.left, bracketRect.top),
      Offset(bracketRect.left + bracketLen, bracketRect.top),
      cornerPaint,
    );

    // Top-right bracket
    canvas.drawLine(
      Offset(bracketRect.right - bracketLen, bracketRect.top),
      Offset(bracketRect.right, bracketRect.top),
      cornerPaint,
    );
    canvas.drawLine(
      Offset(bracketRect.right, bracketRect.top),
      Offset(bracketRect.right, bracketRect.top + bracketLen),
      cornerPaint,
    );

    // Bottom-left bracket
    canvas.drawLine(
      Offset(bracketRect.left, bracketRect.bottom - bracketLen),
      Offset(bracketRect.left, bracketRect.bottom),
      cornerPaint,
    );
    canvas.drawLine(
      Offset(bracketRect.left, bracketRect.bottom),
      Offset(bracketRect.left + bracketLen, bracketRect.bottom),
      cornerPaint,
    );

    // Bottom-right bracket
    canvas.drawLine(
      Offset(bracketRect.right - bracketLen, bracketRect.bottom),
      Offset(bracketRect.right, bracketRect.bottom),
      cornerPaint,
    );
    canvas.drawLine(
      Offset(bracketRect.right, bracketRect.bottom),
      Offset(bracketRect.right, bracketRect.bottom - bracketLen),
      cornerPaint,
    );
  }

  @override
  bool shouldRepaint(covariant FaceOverlayPainter oldDelegate) {
    return oldDelegate.animationValue != animationValue ||
        oldDelegate.isScanning != isScanning ||
        oldDelegate.borderColor != borderColor ||
        oldDelegate.cornerColor != cornerColor;
  }
}
