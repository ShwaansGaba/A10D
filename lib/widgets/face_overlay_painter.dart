import 'package:flutter/material.dart';

/// Custom painter that creates a semi-transparent dark vignette with
/// a blue-colored rectangular bounding box cutout guide and corner accent brackets
/// for face positioning and recognition.
class FaceOverlayPainter extends CustomPainter {
  final double animationValue;
  final bool isScanning;
  final Color borderColor;
  final Color cornerColor;
  final Rect? detectedFaceRect;

  FaceOverlayPainter({
    required this.animationValue,
    this.isScanning = true,
    this.borderColor = const Color(0xFF1D93CA),
    this.cornerColor = const Color(0xFF1D93CA),
    this.detectedFaceRect,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final backgroundPaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.65)
      ..style = PaintingStyle.fill;

    // Define the face scanning rectangular box in the upper-center area
    final boxWidth = size.width * 0.72;
    final boxHeight = size.height * 0.44;
    final center = Offset(size.width / 2, size.height * 0.38);
    final boxRect = Rect.fromCenter(
      center: center,
      width: boxWidth,
      height: boxHeight,
    );
    final boxRRect = RRect.fromRectAndRadius(boxRect, const Radius.circular(22));

    // Punch out the rounded rectangular box from the dark overlay
    final backgroundPath = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height));
    final boxPath = Path()..addRRect(boxRRect);
    final transparentHolePath = Path.combine(
      PathOperation.difference,
      backgroundPath,
      boxPath,
    );

    canvas.drawPath(transparentHolePath, backgroundPaint);

    // Blue rectangular border for the face target
    final borderPaint = Paint()
      ..color = borderColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.2;

    canvas.drawRRect(boxRRect, borderPaint);

    // Animated scanning line inside the box
    if (isScanning) {
      final scanLineY = boxRect.top + (boxRect.height * animationValue);
      final scanLinePaint = Paint()
        ..shader = LinearGradient(
          colors: [
            Colors.transparent,
            borderColor.withValues(alpha: 0.8),
            borderColor,
            borderColor.withValues(alpha: 0.8),
            Colors.transparent,
          ],
        ).createShader(
          Rect.fromLTWH(boxRect.left, scanLineY, boxRect.width, 3),
        )
        ..strokeWidth = 2.5
        ..style = PaintingStyle.stroke;

      // Restrict the scan line within the box bounds
      canvas.save();
      canvas.clipPath(boxPath);
      canvas.drawLine(
        Offset(boxRect.left, scanLineY),
        Offset(boxRect.right, scanLineY),
        scanLinePaint,
      );
      canvas.restore();
    }

    // High-tech corner guides around the blue face box
    final cornerPaint = Paint()
      ..color = cornerColor
      ..strokeWidth = 4.5
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    const padding = 10.0;
    final bracketRect = boxRect.inflate(padding);
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
        oldDelegate.cornerColor != cornerColor ||
        oldDelegate.detectedFaceRect != detectedFaceRect;
  }
}
