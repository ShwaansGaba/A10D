import 'dart:async';
import 'dart:convert';
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
    'created_at': createdAt.toIso8601String(),
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

  // Single Punch Per Day: Employees who have punched in today
  final Set<String> _alreadyPunchedTodaySet = {};

  // Cache employee UUIDs mapped from employee names
  final Map<String, String> _employeeUuidCache = {};

  // Offline queue notifier for UI status indicator
  final ValueNotifier<int> pendingOfflineQueueCount = ValueNotifier<int>(0);
  final ValueNotifier<bool> isNetworkConnected = ValueNotifier<bool>(true);

  Timer? _queueFlushTimer;
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
        if (isNetworkConnected.value) {
          flushOfflineQueue();
          _syncTodayPunchesFromRemote();
          syncEmployeesFromRemote();
        }
      });

      // Realtime live bidirectional sync with Supabase
      _subscribeToRealtimeChanges();

      // Sync Supabase online punches and employee profiles for today
      await _syncTodayPunchesFromRemote();
      await syncEmployeesFromRemote();
    } catch (e) {
      debugPrint('Supabase initialization warning: $e');
    }
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
      final startOfDay = DateTime(now.year, now.month, now.day).toIso8601String();
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
  /// If employees were wiped from web client, local facial cache is wiped instantly.
  Future<void> syncEmployeesFromRemote() async {
    if (!_isInitialized) return;
    try {
      final res = await Supabase.instance.client
          .from('employees')
          .select('id, name, embeddings, photo_url, created_at');

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
      final res = await Supabase.instance.client
          .from('employees')
          .upsert({
            'name': user.name,
            'embeddings': user.embeddings,
            'created_at': user.registeredAt.toIso8601String(),
          })
          .select('id')
          .maybeSingle();

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
    final punchItem = OfflinePunchItem(
      id: '${now.millisecondsSinceEpoch}_$employeeName',
      employeeName: employeeName,
      employeeId: validUuid,
      confidence: (confidence * 100).round() / 100.0,
      deviceId: 'Android Kiosk',
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
          'created_at': punchItem.createdAt.toIso8601String(),
        };
        if (punchItem.employeeId != null) {
          insertData['employee_id'] = punchItem.employeeId;
        }

        await Supabase.instance.client.from('attendance_logs').insert(insertData);
        debugPrint('Attendance for $employeeName pushed online to Supabase.');
        pushedOnline = true;
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
          'created_at': punch.createdAt.toIso8601String(),
        };
        if (punch.employeeId != null) {
          insertData['employee_id'] = punch.employeeId;
        }

        await Supabase.instance.client.from('attendance_logs').insert(insertData);
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
        // Delete all attendance logs from Supabase
        await Supabase.instance.client
            .from('attendance_logs')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000');
        debugPrint('Supabase attendance logs wiped successfully.');
      } catch (e) {
        debugPrint('Supabase attendance logs reset notice: $e');
      }

      try {
        // Delete all employees from Supabase
        await Supabase.instance.client
            .from('employees')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000');
        debugPrint('Supabase employees wiped successfully.');
      } catch (e) {
        debugPrint('Supabase employees reset notice: $e');
      }
    }
  }
}
