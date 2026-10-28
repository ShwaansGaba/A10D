import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
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

  // Offline queue notifier for UI status indicator
  final ValueNotifier<int> pendingOfflineQueueCount = ValueNotifier<int>(0);
  final ValueNotifier<bool> isNetworkConnected = ValueNotifier<bool>(true);

  Timer? _queueFlushTimer;
  Timer? _kioskHeartbeatTimer;
  StreamSubscription? _connectivitySubscription;
  RealtimeChannel? _realtimeChannel;

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
        if (isNetworkConnected.value && isUserLoggedIn) {
          flushOfflineQueue();
          _syncTodayPunchesFromRemote();
          syncEmployeesFromRemote();
        }
      });

      // If user is already logged in, register active kiosk and start heartbeats
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
  // Kiosk Fleet Management & Heartbeat
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
    if (name != null && name.isNotEmpty) return name;
    return 'Android Terminal (Kiosk)';
  }

  Future<void> setDeviceName(String name) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('kiosk_custom_device_name', name.trim());
    if (isUserLoggedIn) {
      await registerKioskOnline();
    }
  }

  Future<void> registerKioskOnline([String? customName]) async {
    if (!_isInitialized || currentUserId == null) return;
    try {
      if (customName != null && customName.trim().isNotEmpty) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('kiosk_custom_device_name', customName.trim());
      }
      final devId = await getDeviceId();
      final devName = await getDeviceName();

      await Supabase.instance.client.from('kiosks').upsert({
        'user_id': currentUserId,
        'device_id': devId,
        'device_name': devName,
        'platform': 'Android',
        'is_active': true,
        'last_heartbeat': DateTime.now().toUtc().toIso8601String(),
      }, onConflict: 'user_id,device_id');

      debugPrint('Kiosk registered active in cloud: $devName ($devId)');
      _startKioskHeartbeat();
    } catch (e) {
      debugPrint('Error registering kiosk online (run MULTI_TENANT_SCHEMA.sql if kiosks table missing): $e');
    }
  }

  void _startKioskHeartbeat() {
    _kioskHeartbeatTimer?.cancel();
    _kioskHeartbeatTimer = Timer.periodic(const Duration(seconds: 30), (_) async {
      if (!_isInitialized || currentUserId == null) return;
      try {
        final devId = await getDeviceId();
        await Supabase.instance.client
            .from('kiosks')
            .update({
              'is_active': true,
              'last_heartbeat': DateTime.now().toUtc().toIso8601String(),
            })
            .eq('user_id', currentUserId!)
            .eq('device_id', devId);
      } catch (e) {
        debugPrint('Kiosk heartbeat update notice: $e');
      }
    });
  }

  Future<void> logout() async {
    _kioskHeartbeatTimer?.cancel();
    if (_isInitialized && currentUserId != null) {
      try {
        final devId = await getDeviceId();
        await Supabase.instance.client
            .from('kiosks')
            .update({
              'is_active': false,
              'last_heartbeat': DateTime.now().toUtc().toIso8601String(),
            })
            .eq('user_id', currentUserId!)
            .eq('device_id', devId);
        debugPrint('Kiosk marked offline on server.');
      } catch (e) {
        debugPrint('Error marking kiosk offline: $e');
      }
    }
    try {
      await Supabase.instance.client.auth.signOut();
    } catch (_) {}
    _alreadyPunchedTodaySet.clear();
    _employeeUuidCache.clear();
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
    _queueFlushTimer?.cancel();
    _connectivitySubscription?.cancel();
    _realtimeChannel?.unsubscribe();
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
  /// If logs were reset or deleted remotely, updates local state immediately.
  Future<void> _syncTodayPunchesFromRemote() async {
    if (!_isInitialized) return;
    try {
      final now = DateTime.now();
      // True start of the local day represented in UTC ISO format
      final startOfDay = DateTime(now.year, now.month, now.day).toUtc().toIso8601String();
      dynamic res;
      try {
        var query = Supabase.instance.client
            .from('attendance_logs')
            .select('employee_name')
            .gte('created_at', startOfDay);
        if (currentUserId != null) {
          query = query.eq('user_id', currentUserId!);
        }
        res = await query;
      } catch (e) {
        if (e.toString().contains('user_id')) {
          res = await Supabase.instance.client
              .from('attendance_logs')
              .select('employee_name')
              .gte('created_at', startOfDay);
        } else {
          rethrow;
        }
      }

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
  /// If employees were wiped from web client, local facial cache is wiped instantly.
  Future<void> syncEmployeesFromRemote() async {
    if (!_isInitialized) return;
    try {
      dynamic res;
      try {
        var query = Supabase.instance.client
            .from('employees')
            .select('id, name, embeddings, photo_url, created_at');
        if (currentUserId != null) {
          query = query.eq('user_id', currentUserId!);
        }
        res = await query;
      } catch (e) {
        if (e.toString().contains('user_id')) {
          res = await Supabase.instance.client
              .from('employees')
              .select('id, name, embeddings, photo_url, created_at');
        } else {
          rethrow;
        }
      }

      final List<Map<String, dynamic>> employeeList =
          List<Map<String, dynamic>>.from(res);

      _employeeUuidCache.clear();
      for (final item in employeeList) {
        if (item['name'] != null && item['id'] != null) {
          _employeeUuidCache[item['name'] as String] = item['id'] as String;
        }
      }

      // Sync with Face Recognition biometric engine
      await FaceRecognitionService().syncFromRemoteEmployees(employeeList);
      debugPrint('Employees synced with Supabase: ${employeeList.length} active employee profiles.');
    } catch (e) {
      debugPrint('Sync employees from remote notice: $e');
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
      if (user.photoPath.isNotEmpty && File(user.photoPath).existsSync()) {
        try {
          final bytes = await File(user.photoPath).readAsBytes();
          photoDataUrl = 'data:image/jpeg;base64,${base64Encode(bytes)}';
        } catch (e) {
          debugPrint('Photo encode notice: $e');
        }
      }

      final payload = <String, dynamic>{
        'name': user.name,
        'photo_url': photoDataUrl,
        'embeddings': user.embeddings,
        'created_at': user.registeredAt.toUtc().toIso8601String(),
      };
      if (currentUserId != null) {
        payload['user_id'] = currentUserId;
      }

      dynamic res;
      try {
        res = await Supabase.instance.client
            .from('employees')
            .upsert(payload)
            .select('id')
            .maybeSingle();
      } catch (e) {
        if (e.toString().contains('user_id')) {
          payload.remove('user_id');
          res = await Supabase.instance.client
              .from('employees')
              .upsert(payload)
              .select('id')
              .maybeSingle();
        } else {
          rethrow;
        }
      }

      if (res != null && res['id'] != null) {
        final uuid = res['id'] as String;
        _employeeUuidCache[user.name] = uuid;
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

    // Resolve valid Postgres UUID
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
          'punch_type': 'IN', // Purely Punch IN
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
          if (e.toString().contains('user_id')) {
            insertData.remove('user_id');
            try {
              await Supabase.instance.client.from('attendance_logs').insert(insertData);
              debugPrint('Attendance for $employeeName pushed online to Supabase without user_id.');
              pushedOnline = true;
            } catch (_) {}
          }
          if (!pushedOnline) rethrow;
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
    if (queue.isEmpty) return;

    debugPrint('Flushing ${queue.length} offline punches to Supabase...');
    final remaining = <OfflinePunchItem>[];

    for (final punch in queue) {
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
        if (punch.employeeId != null) {
          insertData['employee_id'] = punch.employeeId;
        }

        try {
          await Supabase.instance.client.from('attendance_logs').insert(insertData);
        } catch (e) {
          if (e.toString().contains('user_id')) {
            insertData.remove('user_id');
            await Supabase.instance.client.from('attendance_logs').insert(insertData);
          } else {
            rethrow;
          }
        }
        debugPrint('Offline punch for ${punch.employeeName} synced successfully.');
      } catch (e) {
        debugPrint('Failed to sync queued punch: $e');
        remaining.add(punch);
      }
    }

    final prefs = await SharedPreferences.getInstance();
    final jsonList = remaining.map((e) => json.encode(e.toMap())).toList();
    await prefs.setStringList(_offlineQueueKey, jsonList);
    pendingOfflineQueueCount.value = remaining.length;
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
