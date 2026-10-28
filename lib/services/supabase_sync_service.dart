import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/registered_user.dart';
import 'face_recognition_service.dart';

enum PunchStatus {
  success,
  alreadyPunchedToday,
  queuedOffline,
  failed,
}

class OfflinePunchItem {
  final String id;
  final String employeeName;
  final String? employeeId;
  final double confidence;
  final String deviceId;
  final DateTime createdAt;

  OfflinePunchItem({
    required this.id,
    required this.employeeName,
    this.employeeId,
    required this.confidence,
    required this.deviceId,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() => {
    'id': id,
    'employee_name': employeeName,
    'employee_id': employeeId,
    'confidence': confidence,
    'device_id': deviceId,
    'created_at': createdAt.toUtc().toIso8601String(),
  };

  factory OfflinePunchItem.fromMap(Map<String, dynamic> map) => OfflinePunchItem(
    id: map['id'] as String,
    employeeName: map['employee_name'] as String,
    employeeId: map['employee_id'] as String?,
    confidence: (map['confidence'] as num).toDouble(),
    deviceId: map['device_id'] as String? ?? 'Android Kiosk',
    createdAt: DateTime.parse(map['created_at'] as String),
  );
}

class SupabaseSyncService {
  static final SupabaseSyncService _instance =
      SupabaseSyncService._internal();
  factory SupabaseSyncService() => _instance;
  SupabaseSyncService._internal();

  static const String supabaseUrl = 'https://nfgndrewxbvluruvrfhi.supabase.co';
  static const String supabasePublishableKey =
      'sb_publishable_p30cqzBpN1ZBr_kppzXjZw_lFkr80o_';

  bool _isInitialized = false;
  bool get isInitialized => _isInitialized;

  // Supabase Auth State Helpers
  bool get isUserLoggedIn =>
      _isInitialized && Supabase.instance.client.auth.currentSession != null;
  String? get currentUserId =>
      Supabase.instance.client.auth.currentUser?.id;
  String? get currentUserEmail =>
      Supabase.instance.client.auth.currentUser?.email;

  // Single Punch Per Day: Employees who have punched in today
  final Set<String> _alreadyPunchedTodaySet = {};

  // Cache employee UUIDs mapped from employee names
  final Map<String, String> _employeeUuidCache = {};

  String _cachedDeviceName = 'Android Terminal (Kiosk)';
  String get kioskDeviceName => _cachedDeviceName;

  // Offline queue notifier for UI status indicator
  final ValueNotifier<int> pendingOfflineQueueCount = ValueNotifier<int>(0);
  final ValueNotifier<bool> isNetworkConnected = ValueNotifier<bool>(true);

  Timer? _queueFlushTimer;
  Timer? _kioskHeartbeatTimer;
  StreamSubscription? _connectivitySubscription;
  RealtimeChannel? _realtimeChannel;
  RealtimeChannel? _presenceChannel;

  static const String _offlineQueueKey = 'offline_attendance_queue_v2';
  static const String _dailyPunchedKeyPrefix = 'punched_in_today_';

  static final RegExp _uuidRegex = RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  );

  Future<void> initialize() async {
    if (_isInitialized) return;
    try {
      await Supabase.initialize(
        url: supabaseUrl,
        publishableKey: supabasePublishableKey,
      );
      _isInitialized = true;
      debugPrint('Supabase initialized successfully.');

      // Load local today's punches & sync queue
      await _loadLocalTodayPunches();
      await _updatePendingQueueCount();

      // Listen for network connectivity changes
      _connectivitySubscription = Connectivity().onConnectivityChanged.listen((results) {
        final connected = results.isNotEmpty && !results.contains(ConnectivityResult.none);
        isNetworkConnected.value = connected;
        if (connected) {
          flushOfflineQueue();
          syncAllFromRemote();
        }
      });

      // Periodic queue flush & remote sync heartbeat (every 10s)
      _queueFlushTimer = Timer.periodic(const Duration(seconds: 10), (_) {
        if (isNetworkConnected.value) {
          flushOfflineQueue();
          _syncTodayPunchesFromRemote();
          syncEmployeesFromRemote();
        }
      });

      // Only register active kiosk & sync if user is authenticated!
      if (isUserLoggedIn) {
        await registerKioskOnline();
        _subscribeToRealtimeChanges();
        await _syncTodayPunchesFromRemote();
        await syncEmployeesFromRemote();
      }
    } catch (e) {
      debugPrint('Supabase initialization warning: $e');
    }
  }

  // ------------------------------------------------------------------
  // Kiosk Fleet Management & Realtime Presence
  // ------------------------------------------------------------------

  Future<String> getDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    String? id = prefs.getString('kiosk_unique_device_id');
    if (id == null) {
      id = 'kiosk_${DateTime.now().millisecondsSinceEpoch}';
      await prefs.setString('kiosk_unique_device_id', id);
    }
    return id;
  }

  Future<String> getDeviceName() async {
    final prefs = await SharedPreferences.getInstance();
    String? name = prefs.getString('kiosk_custom_device_name');
    if (name != null && name.isNotEmpty) {
      _cachedDeviceName = name;
      return name;
    }
    _cachedDeviceName = 'Android Terminal (Kiosk)';
    return _cachedDeviceName;
  }

  Future<void> setDeviceName(String name) async {
    final prefs = await SharedPreferences.getInstance();
    _cachedDeviceName = name.trim();
    await prefs.setString('kiosk_custom_device_name', _cachedDeviceName);
    await registerKioskOnline();
  }

  Future<void> registerKioskOnline([String? customName]) async {
    // Only register online if the user is authenticated with a valid tenant account
    if (!_isInitialized || !isUserLoggedIn || currentUserId == null) return;
    try {
      if (customName != null && customName.trim().isNotEmpty) {
        final prefs = await SharedPreferences.getInstance();
        _cachedDeviceName = customName.trim();
        await prefs.setString('kiosk_custom_device_name', _cachedDeviceName);
      }
      final devId = await getDeviceId();
      final devName = await getDeviceName();
      final tenantId = currentUserId!;
      final channelName = 'presence_kiosks_$tenantId';

      // 1. Join Tenant-Specific Realtime Presence Fleet Channel
      if (_presenceChannel == null) {
        _presenceChannel = Supabase.instance.client.channel(channelName);
        _presenceChannel!.subscribe((status, error) async {
          if (status == RealtimeSubscribeStatus.subscribed) {
            await _trackKioskPresence(devId, devName);
          }
        });
      } else {
        await _trackKioskPresence(devId, devName);
      }

      // 2. Safe fallback attempt to kiosks table if present
      try {
        final kioskData = <String, dynamic>{
          'device_id': devId,
          'device_name': devName,
          'platform': 'Android Phone',
          'is_active': true,
          'user_id': tenantId,
          'last_heartbeat': DateTime.now().toUtc().toIso8601String(),
        };
        try {
          await Supabase.instance.client.from('kiosks').upsert(kioskData);
        } catch (_) {
          kioskData.remove('user_id');
          await Supabase.instance.client.from('kiosks').upsert(kioskData);
        }
      } catch (_) {}

      debugPrint('Kiosk registered active in cloud for tenant $tenantId: $devName ($devId)');
      _startKioskHeartbeat();
    } catch (e) {
      debugPrint('Error registering kiosk online: $e');
    }
  }

  Future<void> _trackKioskPresence(String devId, String devName) async {
    if (!isUserLoggedIn || currentUserId == null) return;
    try {
      await _presenceChannel?.track({
        'device_id': devId,
        'device_name': devName,
        'platform': 'Android Phone',
        'status': 'ONLINE',
        'user_email': currentUserEmail ?? '',
        'user_id': currentUserId ?? '',
        'online_at': DateTime.now().toUtc().toIso8601String(),
      });
      debugPrint('Presence tracked successfully for $devName ($devId)');
    } catch (e) {
      debugPrint('Presence tracking notice: $e');
    }
  }

  void _startKioskHeartbeat() {
    _kioskHeartbeatTimer?.cancel();
    _kioskHeartbeatTimer = Timer.periodic(const Duration(seconds: 25), (_) async {
      if (!_isInitialized) return;
      try {
        final devId = await getDeviceId();
        final devName = await getDeviceName();
        await _trackKioskPresence(devId, devName);
        try {
          await Supabase.instance.client
              .from('kiosks')
              .update({
                'is_active': true,
                'last_heartbeat': DateTime.now().toUtc().toIso8601String(),
              })
              .eq('device_id', devId);
        } catch (_) {}
      } catch (e) {
        debugPrint('Kiosk heartbeat update notice: $e');
      }
    });
  }

  Future<void> logout() async {
    _kioskHeartbeatTimer?.cancel();
    _kioskHeartbeatTimer = null;
    try {
      await _presenceChannel?.untrack();
      _presenceChannel?.unsubscribe();
      _presenceChannel = null;
    } catch (_) {}
    if (_isInitialized) {
      try {
        final devId = await getDeviceId();
        await Supabase.instance.client
            .from('kiosks')
            .update({
              'is_active': false,
              'last_heartbeat': DateTime.now().toUtc().toIso8601String(),
            })
            .eq('device_id', devId);
      } catch (_) {}
    }
    try {
      await Supabase.instance.client.auth.signOut();
    } catch (_) {}
    _alreadyPunchedTodaySet.clear();
    _employeeUuidCache.clear();
    await FaceRecognitionService().resetAllFaceData();
  }

  void onUserLoggedIn() {
    registerKioskOnline();
    _subscribeToRealtimeChanges();
    syncAllFromRemote();
  }

  void _subscribeToRealtimeChanges() {
    if (!_isInitialized) return;
    try {
      _realtimeChannel = Supabase.instance.client
          .channel('kiosk-bidirectional-sync')
          .onPostgresChanges(
            event: PostgresChangeEvent.all,
            schema: 'public',
            table: 'attendance_logs',
            callback: (payload) {
              debugPrint('Realtime attendance_logs change detected: ${payload.eventType}');
              _syncTodayPunchesFromRemote();
            },
          )
          .onPostgresChanges(
            event: PostgresChangeEvent.all,
            schema: 'public',
            table: 'employees',
            callback: (payload) {
              debugPrint('Realtime employees change detected: ${payload.eventType}');
              syncEmployeesFromRemote();
            },
          )
          .subscribe();
      debugPrint('Kiosk subscribed to Supabase Realtime changes.');
    } catch (e) {
      debugPrint('Realtime channel subscription error: $e');
    }
  }

  void dispose() {
    _kioskHeartbeatTimer?.cancel();
    _queueFlushTimer?.cancel();
    _connectivitySubscription?.cancel();
    _realtimeChannel?.unsubscribe();
    _presenceChannel?.unsubscribe();
  }

  String _getTodayKey() {
    return '$_dailyPunchedKeyPrefix${DateFormat('yyyy_MM_dd').format(DateTime.now())}';
  }

  Future<void> _loadLocalTodayPunches() async {
    final prefs = await SharedPreferences.getInstance();
    final list = prefs.getStringList(_getTodayKey()) ?? [];
    _alreadyPunchedTodaySet.addAll(list);
  }

  Future<void> _recordEmployeePunchedLocally(String employeeName) async {
    _alreadyPunchedTodaySet.add(employeeName);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_getTodayKey(), _alreadyPunchedTodaySet.toList());
  }

  /// Live-sync today's punches from Supabase.
  Future<void> _syncTodayPunchesFromRemote() async {
    if (!_isInitialized) return;
    try {
      final now = DateTime.now();
      // True start of the local day represented in UTC ISO format
      final startOfDay = DateTime(now.year, now.month, now.day).toUtc().toIso8601String();
      final res = await Supabase.instance.client
          .from('attendance_logs')
          .select('employee_name')
          .gte('created_at', startOfDay);

      final remoteNamesToday = <String>{};
      for (final row in res) {
        final name = row['employee_name'] as String?;
        if (name != null && name.trim().isNotEmpty) {
          remoteNamesToday.add(name.trim());
        }
      }

      // Supabase is the source of truth for confirmed punches today
      _alreadyPunchedTodaySet.clear();
      _alreadyPunchedTodaySet.addAll(remoteNamesToday);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_getTodayKey(), _alreadyPunchedTodaySet.toList());
      debugPrint('Today punches reconciled with Supabase: $_alreadyPunchedTodaySet');
    } catch (e) {
      debugPrint('Sync today punches notice: $e');
    }
  }

  /// Live-sync all enrolled employees and facial vectors from Supabase.
  Future<void> syncEmployeesFromRemote() async {
    if (!_isInitialized) return;
    try {
      List<Map<String, dynamic>> employeeList = [];
      try {
        if (currentUserId != null) {
          final res = await Supabase.instance.client
              .from('employees')
              .select('id, name, embeddings, photo_url, created_at')
              .eq('user_id', currentUserId!);
          employeeList = List<Map<String, dynamic>>.from(res);
        } else {
          final res = await Supabase.instance.client
              .from('employees')
              .select('id, name, embeddings, photo_url, created_at');
          employeeList = List<Map<String, dynamic>>.from(res);
        }
      } catch (_) {
        // Fallback if user_id column does not exist in schema
        final res = await Supabase.instance.client
            .from('employees')
            .select('id, name, embeddings, photo_url, created_at');
        employeeList = List<Map<String, dynamic>>.from(res);
      }

      _employeeUuidCache.clear();
      for (final item in employeeList) {
        if (item['name'] != null && item['id'] != null) {
          _employeeUuidCache[item['name'] as String] = item['id'] as String;
        }
      }

      // Sync with Face Recognition biometric engine (authoritative remote sync)
      await FaceRecognitionService().syncFromRemoteEmployees(employeeList);
      debugPrint('Employees synced with Supabase: ${employeeList.length} active employee profiles.');
    } catch (e) {
      debugPrint('Sync employees from remote notice: $e');
    }
  }

  /// Delete an employee from Supabase
  Future<void> deleteEmployee(String employeeId) async {
    if (!_isInitialized) return;
    try {
      await Supabase.instance.client.from('employees').delete().eq('id', employeeId);
      debugPrint('Employee $employeeId deleted from Supabase.');
    } catch (e) {
      debugPrint('Delete employee error: $e');
    }
  }

  /// Perform full bidirectional sync
  Future<void> syncAllFromRemote() async {
    await _syncTodayPunchesFromRemote();
    await syncEmployeesFromRemote();
  }

  /// Checks if an employee has already punched in today
  bool hasAlreadyPunchedToday(String employeeName) {
    return _alreadyPunchedTodaySet.contains(employeeName);
  }

  /// Syncs an enrolled employee and their 3-view biometric embeddings to Supabase
  Future<String?> syncEmployee(RegisteredUser user) async {
    if (!_isInitialized) return null;

    try {
      String? photoDataUrl;
      // Compress and resize photo thumbnail to avoid large payload limits
      if (user.photoPath.isNotEmpty && File(user.photoPath).existsSync()) {
        try {
          final fileBytes = await File(user.photoPath).readAsBytes();
          final decoded = img.decodeImage(fileBytes);
          if (decoded != null) {
            // Resize to crisp 256x256 thumbnail (~10-15KB)
            final resized = img.copyResize(decoded, width: 256, height: 256);
            final compressedBytes = img.encodeJpg(resized, quality: 75);
            photoDataUrl = 'data:image/jpeg;base64,${base64Encode(compressedBytes)}';
          } else {
            photoDataUrl = 'data:image/jpeg;base64,${base64Encode(fileBytes)}';
          }
        } catch (e) {
          debugPrint('Photo encode notice: $e');
        }
      }

      final payload = <String, dynamic>{
        'name': user.name,
        'department': 'General',
        'is_active': true,
        'photo_url': photoDataUrl,
        'embeddings': user.embeddings,
        'created_at': user.registeredAt.toUtc().toIso8601String(),
      };
      if (currentUserId != null) {
        payload['user_id'] = currentUserId;
      }

      // Check if this employee already exists on remote by name
      dynamic existing;
      try {
        existing = await Supabase.instance.client
            .from('employees')
            .select('id')
            .eq('name', user.name)
            .maybeSingle();
      } catch (_) {}

      dynamic res;
      try {
        if (existing != null && existing['id'] != null) {
          final existingId = existing['id'] as String;
          res = await Supabase.instance.client
              .from('employees')
              .update(payload)
              .eq('id', existingId)
              .select('id')
              .maybeSingle();
          _employeeUuidCache[user.name] = existingId;
          debugPrint('Updated employee ${user.name} on Supabase (ID: $existingId)');
          return existingId;
        } else {
          res = await Supabase.instance.client
              .from('employees')
              .insert(payload)
              .select('id')
              .maybeSingle();
        }
      } catch (e) {
        // Fallback: If user_id column is not in schema, try without user_id
        if (payload.containsKey('user_id')) {
          payload.remove('user_id');
          if (existing != null && existing['id'] != null) {
            final existingId = existing['id'] as String;
            res = await Supabase.instance.client
                .from('employees')
                .update(payload)
                .eq('id', existingId)
                .select('id')
                .maybeSingle();
            _employeeUuidCache[user.name] = existingId;
            return existingId;
          } else {
            res = await Supabase.instance.client
                .from('employees')
                .insert(payload)
                .select('id')
                .maybeSingle();
          }
        }
      }

      if (res != null && res['id'] != null) {
        final uuid = res['id'] as String;
        _employeeUuidCache[user.name] = uuid;
        debugPrint('Employee ${user.name} inserted to Supabase with ID $uuid');
        return uuid;
      }
    } catch (e) {
      debugPrint('Supabase employee sync notice: $e');
    }
    return null;
  }

  /// Records a live punch-in with single-punch-per-day enforcement & offline queueing
  Future<PunchStatus> recordAttendanceLog({
    required String employeeName,
    String? employeeId,
    double confidence = 0.95,
  }) async {
    // 1. Single Punch Per Day Check:
    if (hasAlreadyPunchedToday(employeeName)) {
      debugPrint('$employeeName has already punched in today. Anti-double punch active.');
      return PunchStatus.alreadyPunchedToday;
    }

    // Mark locally immediately so subsequent frames within milliseconds cannot re-trigger
    await _recordEmployeePunchedLocally(employeeName);

    // Resolve valid Postgres UUID if present
    String? validUuid;
    if (employeeId != null && _uuidRegex.hasMatch(employeeId)) {
      validUuid = employeeId;
    } else if (_employeeUuidCache.containsKey(employeeName)) {
      validUuid = _employeeUuidCache[employeeName];
    } else {
      try {
        final res = await Supabase.instance.client
            .from('employees')
            .select('id')
            .eq('name', employeeName)
            .maybeSingle();
        if (res != null && res['id'] != null) {
          validUuid = res['id'] as String;
          _employeeUuidCache[employeeName] = validUuid;
        }
      } catch (_) {}
    }

    final now = DateTime.now();
    final devName = await getDeviceName();
    final punchItem = OfflinePunchItem(
      id: '${now.millisecondsSinceEpoch}_$employeeName',
      employeeName: employeeName,
      employeeId: validUuid,
      confidence: (confidence * 100).round() / 100.0,
      deviceId: devName,
      createdAt: now,
    );

    // 2. Try online push to Supabase
    bool pushedOnline = false;
    if (_isInitialized) {
      try {
        final insertData = <String, dynamic>{
          'employee_name': punchItem.employeeName,
          'punch_type': 'IN',
          'confidence': punchItem.confidence,
          'device_id': punchItem.deviceId,
          'created_at': punchItem.createdAt.toUtc().toIso8601String(),
        };
        if (currentUserId != null) {
          insertData['user_id'] = currentUserId;
        }
        if (punchItem.employeeId != null) {
          insertData['employee_id'] = punchItem.employeeId;
        }

        try {
          await Supabase.instance.client.from('attendance_logs').insert(insertData);
          debugPrint('Attendance for $employeeName pushed online to Supabase.');
          pushedOnline = true;
        } catch (e) {
          debugPrint('Initial attendance log insert notice: $e. Retrying without user_id / employee_id fallback...');
          insertData.remove('employee_id');
          insertData.remove('user_id');
          await Supabase.instance.client.from('attendance_logs').insert(insertData);
          debugPrint('Attendance for $employeeName pushed online without user_id / employee_id.');
          pushedOnline = true;
        }
      } catch (e) {
        debugPrint('Supabase online insert failed (offline mode activated): $e');
        pushedOnline = false;
      }
    }

    // 3. If offline, save to persistent local queue
    if (!pushedOnline) {
      await _addToOfflineQueue(punchItem);
      return PunchStatus.queuedOffline;
    }

    return PunchStatus.success;
  }

  Future<void> _addToOfflineQueue(OfflinePunchItem item) async {
    final prefs = await SharedPreferences.getInstance();
    final queue = await _getOfflineQueue();
    queue.add(item);
    final jsonList = queue.map((e) => json.encode(e.toMap())).toList();
    await prefs.setStringList(_offlineQueueKey, jsonList);
    await _updatePendingQueueCount();
    debugPrint('Punch saved to offline queue. Pending count: ${queue.length}');
  }

  Future<List<OfflinePunchItem>> _getOfflineQueue() async {
    final prefs = await SharedPreferences.getInstance();
    final jsonList = prefs.getStringList(_offlineQueueKey) ?? [];
    return jsonList
        .map((s) => OfflinePunchItem.fromMap(json.decode(s) as Map<String, dynamic>))
        .toList();
  }

  Future<void> _updatePendingQueueCount() async {
    final queue = await _getOfflineQueue();
    pendingOfflineQueueCount.value = queue.length;
  }

  /// Flushes all pending offline punches to Supabase
  Future<void> flushOfflineQueue() async {
    if (!_isInitialized) return;
    final queue = await _getOfflineQueue();
    if (queue.isEmpty) {
      pendingOfflineQueueCount.value = 0;
      return;
    }

    debugPrint('Flushing ${queue.length} offline punches to Supabase...');
    final remaining = <OfflinePunchItem>[];

    final now = DateTime.now();
    for (final punch in queue) {
      // Discard stale punches older than 48 hours to prevent stuck "SYNCING" loop
      if (now.difference(punch.createdAt).inHours > 48) {
        debugPrint('Discarding expired offline punch for ${punch.employeeName}');
        continue;
      }

      try {
        final insertData = <String, dynamic>{
          'employee_name': punch.employeeName,
          'punch_type': 'IN',
          'confidence': punch.confidence,
          'device_id': punch.deviceId,
          'created_at': punch.createdAt.toUtc().toIso8601String(),
        };
        if (currentUserId != null) {
          insertData['user_id'] = currentUserId;
        }
        if (punch.employeeId != null && _uuidRegex.hasMatch(punch.employeeId!)) {
          insertData['employee_id'] = punch.employeeId;
        }

        try {
          await Supabase.instance.client.from('attendance_logs').insert(insertData);
          debugPrint('Offline punch for ${punch.employeeName} synced successfully.');
        } catch (e) {
          debugPrint('Queued punch retry without user_id/employee_id fallback: $e');
          insertData.remove('employee_id');
          insertData.remove('user_id');
          await Supabase.instance.client.from('attendance_logs').insert(insertData);
          debugPrint('Offline punch for ${punch.employeeName} synced successfully with fallback.');
        }
      } catch (e) {
        debugPrint('Failed to sync queued punch: $e');
        remaining.add(punch);
      }
    }

    final prefs = await SharedPreferences.getInstance();
    final jsonList = remaining.map((e) => json.encode(e.toMap())).toList();
    await prefs.setStringList(_offlineQueueKey, jsonList);
    pendingOfflineQueueCount.value = remaining.length;
    debugPrint('Offline queue flushed. Remaining: ${remaining.length}');
  }

  /// Completely resets all attendance punches, offline queues, and remote Supabase tables if requested
  Future<void> resetAllAttendanceData({bool resetRemoteSupabase = true}) async {
    _alreadyPunchedTodaySet.clear();
    _employeeUuidCache.clear();

    final prefs = await SharedPreferences.getInstance();
    // Clear offline queue
    await prefs.remove(_offlineQueueKey);
    pendingOfflineQueueCount.value = 0;

    // Clear today and past punch keys
    final keys = prefs.getKeys();
    for (final key in keys) {
      if (key.startsWith(_dailyPunchedKeyPrefix)) {
        await prefs.remove(key);
      }
    }

    if (resetRemoteSupabase && _isInitialized) {
      try {
        var query = Supabase.instance.client.from('attendance_logs').select('id');
        if (currentUserId != null) query = query.eq('user_id', currentUserId!);
        final logs = await query;
        for (final row in logs) {
          if (row['id'] != null) {
            await Supabase.instance.client.from('attendance_logs').delete().eq('id', row['id']);
          }
        }
        if (currentUserId != null) {
          await Supabase.instance.client.from('attendance_logs').delete().eq('user_id', currentUserId!);
        }
        debugPrint('Supabase attendance logs wiped successfully.');
      } catch (e) {
        debugPrint('Supabase attendance logs reset notice: $e');
      }

      try {
        var query = Supabase.instance.client.from('employees').select('id');
        if (currentUserId != null) query = query.eq('user_id', currentUserId!);
        final emps = await query;
        for (final row in emps) {
          if (row['id'] != null) {
            await Supabase.instance.client.from('employees').delete().eq('id', row['id']);
          }
        }
        if (currentUserId != null) {
          await Supabase.instance.client.from('employees').delete().eq('user_id', currentUserId!);
        }
        debugPrint('Supabase employees wiped successfully.');
      } catch (e) {
        debugPrint('Supabase employees reset notice: $e');
      }
    }
  }
}
