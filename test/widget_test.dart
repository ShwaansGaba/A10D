import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:attendance_app/main.dart';

void main() {
  testWidgets('Face attendance app minimalist layout smoke test', (WidgetTester tester) async {
    // Build app with empty camera list
    await tester.pumpWidget(const FaceAttendanceApp(cameras: []));

    // Verify top-left '+' button exists and no manual punch buttons exist
    expect(find.byIcon(Icons.add_rounded), findsOneWidget);
    expect(find.text('Punch In'), findsNothing);
    expect(find.text('Punch Out'), findsNothing);
  });
}
