import 'dart:async';
import 'dart:convert';
import 'dart:io';

class AppConfig {
  String environment; // 'test' or 'prod'
  String apiKey;
  String apiSecret;
  String redirectUrl;
  bool useSimulation;

  AppConfig({
    this.environment = 'test',
    this.apiKey = 'key_test_76b8b507d3e94a038fc3733cea38d501',
    this.apiSecret = 'secret_test_dc6a517ce2c149fe904a93e609fcf05f',
    this.redirectUrl = 'http://localhost:8080/callback',
    this.useSimulation = false,
  });

  String get baseUrl => environment == 'prod'
      ? 'https://api.sandbox.co.in'
      : 'https://test-api.sandbox.co.in';

  Map<String, dynamic> toJson({bool maskSecret = true}) => {
        'environment': environment,
        'apiKey': apiKey,
        'apiSecret': maskSecret && apiSecret.length > 8
            ? '${apiSecret.substring(0, 6)}••••••••${apiSecret.substring(apiSecret.length - 4)}'
            : apiSecret,
        'redirectUrl': redirectUrl,
        'useSimulation': useSimulation,
        'baseUrl': baseUrl,
      };
}

final config = AppConfig();
String? cachedAccessToken;
DateTime? tokenExpiry;

// In-memory store for active sessions
final Map<String, Map<String, dynamic>> sessions = {};

final HttpClient httpClient = HttpClient()
  ..badCertificateCallback = (cert, host, port) => true;

Future<void> main() async {
  final port = int.tryParse(Platform.environment['PORT'] ?? '8080') ?? 8080;
  
  HttpServer server;
  try {
    server = await HttpServer.bind(InternetAddress.anyIPv4, port);
  } catch (e) {
    print('Port $port occupied, binding to 8081...');
    server = await HttpServer.bind(InternetAddress.anyIPv4, 8081);
  }

  print('======================================================');
  print('  DigiLocker Aadhaar Verification Gateway Running');
  print('  URL: http://localhost:${server.port}');
  print('  Active Mode: ${config.useSimulation ? "SIMULATOR" : config.environment.toUpperCase()}');
  print('======================================================');

  await for (final HttpRequest request in server) {
    handleRequest(request, server.port);
  }
}

Future<void> handleRequest(HttpRequest request, int serverPort) async {
  // Enable CORS
  request.response.headers.add('Access-Control-Allow-Origin', '*');
  request.response.headers.add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  request.response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (request.method == 'OPTIONS') {
    request.response.statusCode = HttpStatus.ok;
    await request.response.close();
    return;
  }

  final path = request.uri.path;

  try {
    if (path == '/api/config') {
      if (request.method == 'GET') {
        sendJson(request, config.toJson());
      } else if (request.method == 'POST') {
        final body = await readJsonBody(request);
        if (body.containsKey('environment')) config.environment = body['environment'];
        if (body.containsKey('apiKey')) config.apiKey = body['apiKey'];
        if (body.containsKey('apiSecret') && !body['apiSecret'].toString().contains('•••')) {
          config.apiSecret = body['apiSecret'];
        }
        if (body.containsKey('redirectUrl')) config.redirectUrl = body['redirectUrl'];
        if (body.containsKey('useSimulation')) config.useSimulation = body['useSimulation'] == true;
        
        // Reset cached token if credentials change
        cachedAccessToken = null;
        tokenExpiry = null;
        sendJson(request, {'success': true, 'config': config.toJson()});
      }
      return;
    }

    if (path == '/api/digilocker/init' && request.method == 'POST') {
      await handleInitSession(request, serverPort);
      return;
    }

    if (path == '/api/digilocker/status' && request.method == 'GET') {
      final sessionId = request.uri.queryParameters['session_id'];
      if (sessionId == null) {
        sendJson(request, {'error': 'Missing session_id parameter'}, status: HttpStatus.badRequest);
        return;
      }
      await handleGetStatus(request, sessionId);
      return;
    }

    if (path == '/api/digilocker/document' && request.method == 'GET') {
      final sessionId = request.uri.queryParameters['session_id'];
      if (sessionId == null) {
        sendJson(request, {'error': 'Missing session_id parameter'}, status: HttpStatus.badRequest);
        return;
      }
      await handleGetDocument(request, sessionId);
      return;
    }

    if (path == '/callback') {
      await handleCallback(request);
      return;
    }

    if (path == '/simulate-digilocker') {
      await handleSimulationPage(request);
      return;
    }

    if (path == '/api/simulate/consent' && request.method == 'POST') {
      await handleSimulationConsent(request);
      return;
    }

    // Static file serving
    await serveStaticFile(request, path);
  } catch (e, stack) {
    print('Server Error: $e\n$stack');
    sendJson(request, {
      'error': 'Internal server error',
      'details': e.toString(),
    }, status: HttpStatus.internalServerError);
  }
}

Future<void> handleInitSession(HttpRequest request, int serverPort) async {
  final body = await readJsonBody(request);
  final clientRedirect = body['redirect_url']?.toString().isNotEmpty == true
      ? body['redirect_url'].toString()
      : 'http://localhost:$serverPort/callback';

  final forceSimulation = body['force_simulation'] == true || config.useSimulation;

  if (forceSimulation) {
    final sessionId = 'sim_${DateTime.now().millisecondsSinceEpoch}_${(1000 + (DateTime.now().microsecond % 9000))}';
    sessions[sessionId] = {
      'status': 'initiated',
      'created_at': DateTime.now().toIso8601String(),
      'is_simulation': true,
      'redirect_url': clientRedirect,
    };

    final authUrl = '/simulate-digilocker?session_id=$sessionId&redirect_url=${Uri.encodeComponent(clientRedirect)}';

    sendJson(request, {
      'code': 200,
      'status': 'success',
      'data': {
        'session_id': sessionId,
        'authorization_url': authUrl,
        'mode': 'simulation',
        'message': 'Session initiated in DigiLocker Simulation Sandbox',
      }
    });
    return;
  }

  // Real Sandbox API call
  try {
    final token = await getSandboxAccessToken();

    final initUri = Uri.parse('${config.baseUrl}/kyc/digilocker/sessions/init');
    final apiReq = await httpClient.postUrl(initUri);
    apiReq.headers.set('Authorization', token);
    apiReq.headers.set('x-api-key', config.apiKey);
    apiReq.headers.set('x-api-version', '1.0.0');
    apiReq.headers.set('Content-Type', 'application/json');

    final payload = {
      '@entity': 'in.co.sandbox.kyc.digilocker.session.request',
      'flow': 'signin',
      'doc_types': ['aadhaar'],
      'redirect_url': clientRedirect,
      'purpose': 'Know Your Customer Verification',
      'options': {
        'pinless': true,
        'usernameless': true,
      }
    };

    apiReq.add(utf8.encode(jsonEncode(payload)));
    final apiRes = await apiReq.close();
    final resBody = await utf8.decodeStream(apiRes);
    final jsonRes = jsonDecode(resBody);

    if (apiRes.statusCode == 200 && jsonRes['data'] != null) {
      final sessionId = jsonRes['data']['session_id'] ?? '';
      final authUrl = jsonRes['data']['authorization_url'] ?? '';

      sessions[sessionId] = {
        'status': 'initiated',
        'created_at': DateTime.now().toIso8601String(),
        'is_simulation': false,
        'raw_init': jsonRes,
      };

      sendJson(request, {
        'code': 200,
        'status': 'success',
        'data': {
          'session_id': sessionId,
          'authorization_url': authUrl,
          'mode': 'sandbox_api',
          'raw': jsonRes,
        }
      });
      return;
    } else {
      // Handle known API privilege issue or errors
      final isPrivilegeError = apiRes.statusCode == 403 || resBody.contains('Insufficient privilege');
      sendJson(request, {
        'code': apiRes.statusCode,
        'error': jsonRes['message'] ?? 'Sandbox API returned error',
        'is_privilege_error': isPrivilegeError,
        'suggest_simulation': true,
        'details': jsonRes,
      }, status: apiRes.statusCode);
      return;
    }
  } catch (e) {
    sendJson(request, {
      'code': 500,
      'error': 'Failed to communicate with Sandbox API',
      'details': e.toString(),
      'suggest_simulation': true,
    }, status: HttpStatus.internalServerError);
  }
}

Future<void> handleGetStatus(HttpRequest request, String sessionId) async {
  final session = sessions[sessionId];

  if (session != null && session['is_simulation'] == true) {
    sendJson(request, {
      'code': 200,
      'data': {
        'session_id': sessionId,
        'status': session['status'] ?? 'initiated',
        'mode': 'simulation',
      }
    });
    return;
  }

  // Real Sandbox API call
  try {
    final token = await getSandboxAccessToken();
    final statusUri = Uri.parse('${config.baseUrl}/kyc/digilocker/sessions/$sessionId/status');
    final apiReq = await httpClient.getUrl(statusUri);
    apiReq.headers.set('Authorization', token);
    apiReq.headers.set('x-api-key', config.apiKey);
    apiReq.headers.set('x-api-version', '1.0.0');

    final apiRes = await apiReq.close();
    final resBody = await utf8.decodeStream(apiRes);
    final jsonRes = jsonDecode(resBody);

    sendJson(request, jsonRes, status: apiRes.statusCode);
  } catch (e) {
    sendJson(request, {'error': e.toString()}, status: HttpStatus.internalServerError);
  }
}

Future<void> handleGetDocument(HttpRequest request, String sessionId) async {
  final session = sessions[sessionId];

  if (session != null && session['is_simulation'] == true) {
    // Generate realistic simulated UIDAI offline Aadhaar verification details
    final mockAadhaar = getMockAadhaarData(sessionId);
    sendJson(request, {
      'code': 200,
      'status': 'success',
      'mode': 'simulation',
      'data': mockAadhaar,
    });
    return;
  }

  // Real Sandbox API call
  try {
    final token = await getSandboxAccessToken();
    final docUri = Uri.parse('${config.baseUrl}/kyc/digilocker/sessions/$sessionId/documents/aadhaar');
    final apiReq = await httpClient.getUrl(docUri);
    apiReq.headers.set('Authorization', token);
    apiReq.headers.set('x-api-key', config.apiKey);
    apiReq.headers.set('x-api-version', '1.0.0');

    final apiRes = await apiReq.close();
    final resBody = await utf8.decodeStream(apiRes);
    final jsonRes = jsonDecode(resBody);

    if (apiRes.statusCode == 200 && jsonRes['data']?['files'] != null) {
      final List files = jsonRes['data']['files'];
      if (files.isNotEmpty) {
        final fileUrl = files[0]['url'];
        // Download XML content from S3 url
        final s3Req = await httpClient.getUrl(Uri.parse(fileUrl));
        final s3Res = await s3Req.close();
        final xmlContent = await utf8.decodeStream(s3Res);
        final parsed = parseAadhaarXml(xmlContent);

        sendJson(request, {
          'code': 200,
          'status': 'success',
          'mode': 'sandbox_api',
          'data': {
            ...parsed,
            'raw_metadata': files[0]['metadata'],
            'raw_xml': xmlContent,
          }
        });
        return;
      }
    }

    sendJson(request, jsonRes, status: apiRes.statusCode);
  } catch (e) {
    sendJson(request, {'error': e.toString()}, status: HttpStatus.internalServerError);
  }
}

Future<void> handleCallback(HttpRequest request) async {
  final params = request.uri.queryParameters;
  final sessionId = params['session_id'] ?? params['state'] ?? '';
  final status = params['status'] ?? 'success';

  if (sessionId.isNotEmpty && sessions.containsKey(sessionId)) {
    sessions[sessionId]!['status'] = status == 'denied' ? 'failed' : 'succeeded';
    sessions[sessionId]!['updated_at'] = DateTime.now().toIso8601String();
  }

  // Render a clean return redirect page back to the app UI
  request.response.headers.contentType = ContentType.html;
  request.response.write('''
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>DigiLocker Consent Received</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #0f172a; color: white; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 40px; text-align: center; max-width: 420px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    .spinner { border: 4px solid #334155; border-top: 4px solid #38bdf8; border-radius: 50%; width: 44px; height: 44px; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    h2 { margin: 0 0 10px; font-size: 22px; color: #f8fafc; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    a.btn { display: inline-block; background: #2563eb; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>Consent Recorded</h2>
    <p>DigiLocker has authorized access. Finalizing your Aadhaar verification and retrieving digital certificate...</p>
    <a href="/?session_id=$sessionId&status=$status" class="btn">Return to Application</a>
  </div>
  <script>
    setTimeout(function() {
      window.location.href = "/?session_id=$sessionId&status=$status";
    }, 1500);
  </script>
</body>
</html>
''');
  await request.response.close();
}

Future<void> handleSimulationPage(HttpRequest request) async {
  final params = request.uri.queryParameters;
  final sessionId = params['session_id'] ?? '';
  final redirectUrl = params['redirect_url'] ?? '/callback';

  request.response.headers.contentType = ContentType.html;
  request.response.write('''
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DigiLocker - MeriPehchaan Simulation</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>body { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="bg-slate-100 min-h-screen flex flex-col justify-between">
  <!-- DigiLocker Official Styled Header -->
  <header class="bg-white border-b border-slate-200 px-6 py-4 shadow-sm flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <div class="w-10 h-10 bg-blue-700 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow">
        DL
      </div>
      <div>
        <h1 class="text-lg font-bold text-slate-800 leading-tight">DigiLocker</h1>
        <p class="text-xs text-slate-500 font-medium">Digital India Platform &bull; Government of India</p>
      </div>
    </div>
    <div class="flex items-center space-x-2 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1 rounded-full text-xs font-semibold">
      <span>●</span>
      <span>Sandbox Simulation Mode</span>
    </div>
  </header>

  <!-- Consent Container -->
  <main class="flex-grow flex items-center justify-center p-4">
    <div class="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
      <!-- Top banner -->
      <div class="bg-gradient-to-r from-blue-700 to-indigo-800 text-white p-6">
        <span class="inline-block bg-blue-500/30 text-blue-100 text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider mb-2">
          Consent Request
        </span>
        <h2 class="text-xl font-bold">Document Access Authorization</h2>
        <p class="text-blue-100 text-sm mt-1">Attendance & Verification System is requesting access to your verified UIDAI Aadhaar credentials.</p>
      </div>

      <div class="p-6 space-y-5">
        <!-- Requested Documents -->
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Requested Document</div>
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 rounded-lg bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-600 font-bold text-lg">
              🆔
            </div>
            <div>
              <div class="font-bold text-slate-800 text-sm">UIDAI Aadhaar (e-KYC Offline XML)</div>
              <div class="text-xs text-slate-500">Includes Name, DOB, Gender, Address & Profile Photo</div>
            </div>
          </div>
        </div>

        <!-- Simulated Mobile OTP Input -->
        <div class="space-y-3">
          <label class="block text-xs font-semibold text-slate-700 uppercase tracking-wide">
            Enter Aadhaar-Linked OTP (Simulator Pre-filled)
          </label>
          <div class="flex items-center space-x-2">
            <input type="text" id="otpInput" value="482910" maxlength="6"
              class="w-full tracking-widest text-center font-mono font-bold text-lg bg-slate-50 border border-slate-300 rounded-lg py-2.5 focus:ring-2 focus:ring-blue-600 focus:outline-none">
          </div>
          <p class="text-xs text-slate-500 flex items-center">
            <svg class="w-4 h-4 text-emerald-600 mr-1.5 inline" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
            </svg>
            Mock OTP auto-verified for testing Sandbox flows.
          </p>
        </div>

        <!-- Simulated Identity Select -->
        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1.5">
            Select Test Profile to Issue
          </label>
          <select id="profileSelect" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-blue-600">
            <option value="rahul">Rahul Sharma (DOB: 14/08/1994, New Delhi)</option>
            <option value="priya">Priya Patel (DOB: 22/11/1998, Mumbai)</option>
            <option value="aarav">Aarav Verma (DOB: 05/03/2001, Bengaluru)</option>
          </select>
        </div>

        <!-- Consent Actions -->
        <div class="pt-2 flex items-center space-x-3">
          <button onclick="submitConsent('denied')"
            class="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-slate-700 font-semibold text-sm hover:bg-slate-50 transition">
            Deny Access
          </button>
          <button onclick="submitConsent('success')"
            class="flex-1 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-semibold text-sm shadow-md hover:shadow transition flex items-center justify-center space-x-1.5">
            <span>Allow & Share</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="bg-slate-50 border-t border-slate-200 px-6 py-3 text-center text-xs text-slate-400">
        Simulated under MeriPehchaan SSO Protocol &bull; Digital India
      </div>
    </div>
  </main>

  <footer class="text-center py-4 text-xs text-slate-400">
    DigiLocker Sandbox Emulator &bull; Aadhaar Offline e-KYC
  </footer>

  <script>
    async function submitConsent(action) {
      const profile = document.getElementById('profileSelect').value;
      const res = await fetch('/api/simulate/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: '$sessionId',
          status: action,
          profile: profile
        })
      });

      const redirect = '$redirectUrl' + 
        ('$redirectUrl'.includes('?') ? '&' : '?') + 
        'session_id=$sessionId&status=' + action;

      window.location.href = redirect;
    }
  </script>
</body>
</html>
''');
  await request.response.close();
}

Future<void> handleSimulationConsent(HttpRequest request) async {
  final body = await readJsonBody(request);
  final sessionId = body['session_id']?.toString() ?? '';
  final status = body['status']?.toString() ?? 'success';
  final profile = body['profile']?.toString() ?? 'rahul';

  if (sessionId.isNotEmpty) {
    sessions[sessionId] = {
      'status': status == 'denied' ? 'failed' : 'succeeded',
      'profile': profile,
      'is_simulation': true,
      'updated_at': DateTime.now().toIso8601String(),
    };
  }

  sendJson(request, {'success': true, 'session_id': sessionId, 'status': status});
}

Future<void> serveStaticFile(HttpRequest request, String requestPath) async {
  var normalizedPath = requestPath == '/' ? '/index.html' : requestPath;
  var filePath = 'digilocker-aadhaar-portal/public$normalizedPath';

  var file = File(filePath);
  if (!await file.exists()) {
    // Fallback to index.html for SPA routes
    file = File('digilocker-aadhaar-portal/public/index.html');
  }

  if (await file.exists()) {
    final mimeType = getMimeType(file.path);
    request.response.headers.set('Content-Type', mimeType);
    await file.openRead().pipe(request.response);
  } else {
    request.response.statusCode = HttpStatus.notFound;
    request.response.write('Not Found');
    await request.response.close();
  }
}

String getMimeType(String path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

Future<String> getSandboxAccessToken() async {
  if (cachedAccessToken != null && tokenExpiry != null && DateTime.now().isBefore(tokenExpiry!)) {
    return cachedAccessToken!;
  }

  final authUri = Uri.parse('${config.baseUrl}/authenticate');
  final req = await httpClient.postUrl(authUri);
  req.headers.set('x-api-key', config.apiKey);
  req.headers.set('x-api-secret', config.apiSecret);
  req.headers.set('x-api-version', '1.0.0');
  req.headers.set('Content-Type', 'application/json');

  final res = await req.close();
  final resBody = await utf8.decodeStream(res);
  final json = jsonDecode(resBody);

  if (res.statusCode == 200) {
    cachedAccessToken = json['access_token'] ?? json['data']?['access_token'];
    // Default token validity 23 hours
    tokenExpiry = DateTime.now().add(const Duration(hours: 23));
    return cachedAccessToken!;
  } else {
    throw Exception('Authentication failed: ${json['message'] ?? resBody}');
  }
}

Map<String, dynamic> parseAadhaarXml(String xml) {
  // Regex extracts for UIDAI offline eKYC schema elements
  final nameMatch = RegExp(r'name="([^"]+)"').firstMatch(xml);
  final dobMatch = RegExp(r'dob="([^"]+)"').firstMatch(xml);
  final genderMatch = RegExp(r'gender="([^"]+)"').firstMatch(xml);
  final photoMatch = RegExp(r'<Pht>([^<]+)</Pht>').firstMatch(xml);

  // Address fields
  final coMatch = RegExp(r'co="([^"]+)"').firstMatch(xml);
  final houseMatch = RegExp(r'house="([^"]+)"').firstMatch(xml);
  final streetMatch = RegExp(r'street="([^"]+)"').firstMatch(xml);
  final locMatch = RegExp(r'loc="([^"]+)"').firstMatch(xml);
  final vtcMatch = RegExp(r'vtc="([^"]+)"').firstMatch(xml);
  final distMatch = RegExp(r'dist="([^"]+)"').firstMatch(xml);
  final stateMatch = RegExp(r'state="([^"]+)"').firstMatch(xml);
  final pcMatch = RegExp(r'pc="([^"]+)"').firstMatch(xml);

  final addressParts = [
    if (coMatch != null) coMatch.group(1),
    if (houseMatch != null) houseMatch.group(1),
    if (streetMatch != null) streetMatch.group(1),
    if (locMatch != null) locMatch.group(1),
    if (vtcMatch != null) vtcMatch.group(1),
    if (distMatch != null) distMatch.group(1),
    if (stateMatch != null) stateMatch.group(1),
    if (pcMatch != null) 'PIN: ${pcMatch.group(1)}',
  ];

  return {
    'name': nameMatch?.group(1) ?? 'Aadhaar Holder',
    'dob': dobMatch?.group(1) ?? '01-01-1990',
    'gender': (genderMatch?.group(1) ?? 'M').toUpperCase().startsWith('M') ? 'MALE' : 'FEMALE',
    'masked_aadhaar': 'XXXX-XXXX-${1000 + (xml.hashCode.abs() % 9000)}',
    'photo': photoMatch?.group(1),
    'address': addressParts.join(', '),
    'care_of': coMatch?.group(1) ?? '',
    'pincode': pcMatch?.group(1) ?? '',
    'state': stateMatch?.group(1) ?? '',
    'district': distMatch?.group(1) ?? '',
  };
}

Map<String, dynamic> getMockAadhaarData(String sessionId) {
  final session = sessions[sessionId] ?? {};
  final profile = session['profile'] ?? 'rahul';

  if (profile == 'priya') {
    return {
      'name': 'Priya Patel',
      'dob': '22-11-1998',
      'gender': 'FEMALE',
      'masked_aadhaar': 'XXXX-XXXX-8921',
      'care_of': 'D/O: Mukesh Patel',
      'address': 'Flat 402, Sea Green Apartments, Bandra West, Mumbai, Maharashtra, PIN: 400050',
      'district': 'Mumbai Suburban',
      'state': 'Maharashtra',
      'pincode': '400050',
      'issuer': 'Unique Identification Authority of India (UIDAI)',
      'verification_timestamp': DateTime.now().toIso8601String(),
      'photo': null, // UI provides realistic avatar
    };
  } else if (profile == 'aarav') {
    return {
      'name': 'Aarav Verma',
      'dob': '05-03-2001',
      'gender': 'MALE',
      'masked_aadhaar': 'XXXX-XXXX-3419',
      'care_of': 'S/O: Rajesh Verma',
      'address': 'Plot 12, Indiranagar 100ft Road, Bengaluru, Karnataka, PIN: 560038',
      'district': 'Bengaluru Urban',
      'state': 'Karnataka',
      'pincode': '560038',
      'issuer': 'Unique Identification Authority of India (UIDAI)',
      'verification_timestamp': DateTime.now().toIso8601String(),
      'photo': null,
    };
  }

  // Default Rahul
  return {
    'name': 'Rahul Sharma',
    'dob': '14-08-1994',
    'gender': 'MALE',
    'masked_aadhaar': 'XXXX-XXXX-6712',
    'care_of': 'S/O: Devendra Sharma',
    'address': 'B-44, Sector 62, Noida, Gautam Buddha Nagar, Uttar Pradesh, PIN: 201301',
    'district': 'Gautam Buddha Nagar',
    'state': 'Uttar Pradesh',
    'pincode': '201301',
    'issuer': 'Unique Identification Authority of India (UIDAI)',
    'verification_timestamp': DateTime.now().toIso8601String(),
    'photo': null,
  };
}

Future<Map<String, dynamic>> readJsonBody(HttpRequest request) async {
  final content = await utf8.decodeStream(request);
  if (content.trim().isEmpty) return {};
  return jsonDecode(content) as Map<String, dynamic>;
}

void sendJson(HttpRequest request, dynamic data, {int status = HttpStatus.ok}) {
  request.response.statusCode = status;
  request.response.headers.contentType = ContentType.json;
  request.response.write(jsonEncode(data));
  request.response.close();
}
