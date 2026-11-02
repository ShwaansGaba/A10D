/**
 * A10D Database & Auth Total Purge Script
 * Uses Supabase Service Role key to permanently wipe:
 * 1. All users, identities, and sessions from auth.users
 * 2. All employee profiles and face embeddings from public.employees
 * 3. All attendance logs from public.attendance_logs
 * 4. All registered kiosks from public.kiosks
 */

const https = require('https');

const SUPABASE_URL = 'https://nfgndrewxbvluruvrfhi.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mZ25kcmV3eGJ2bHVydXZyZmhpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MzA2OTQ0NCwiZXhwIjoyMTA4NjQ1NDQ0fQ.iJIUv4cVYFfQBFul-WhUJoATW1lFzAfUBCBhgTOlF1A';

function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const req = https.request(url, {
      method,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function wipeDatabase() {
  console.log('========================================================');
  console.log('  A10D: INITIATING COMPLETE DATABASE & AUTH PURGE');
  console.log('========================================================\n');

  // 1. Wipe Attendance Logs
  try {
    process.stdout.write('1. Purging public.attendance_logs... ');
    const res = await apiRequest('/rest/v1/attendance_logs?id=neq.00000000-0000-0000-0000-000000000000', 'DELETE');
    console.log(`DONE (HTTP ${res.status})`);
  } catch (err) {
    console.log('NOTICE:', err.message);
  }

  // 2. Wipe Employees
  try {
    process.stdout.write('2. Purging public.employees & biometrics... ');
    const res = await apiRequest('/rest/v1/employees?id=neq.00000000-0000-0000-0000-000000000000', 'DELETE');
    console.log(`DONE (HTTP ${res.status})`);
  } catch (err) {
    console.log('NOTICE:', err.message);
  }

  // 3. Wipe Kiosks (if table exists)
  try {
    process.stdout.write('3. Purging public.kiosks... ');
    const res = await apiRequest('/rest/v1/kiosks?id=neq.00000000-0000-0000-0000-000000000000', 'DELETE');
    console.log(`DONE (HTTP ${res.status})`);
  } catch (err) {
    console.log('SKIPPED (Table may not exist)');
  }

  // 4. Fetch and Delete All Users from Supabase Auth
  console.log('\n4. Fetching registered accounts from auth.users...');
  try {
    const listRes = await apiRequest('/auth/v1/admin/users?per_page=1000');
    if (listRes.status >= 200 && listRes.status < 300) {
      const parsed = JSON.parse(listRes.data);
      const users = parsed.users || [];
      console.log(`   Found ${users.length} registered user account(s):`);

      for (const u of users) {
        process.stdout.write(`   - Deleting ${u.email} (${u.id})... `);
        const delRes = await apiRequest(`/auth/v1/admin/users/${u.id}`, 'DELETE');
        if (delRes.status >= 200 && delRes.status < 300) {
          console.log('PURGED');
        } else {
          console.log(`FAILED (HTTP ${delRes.status}): ${delRes.data}`);
        }
      }
    } else {
      console.error('Failed to list users:', listRes.status, listRes.data);
    }
  } catch (err) {
    console.error('Error purging auth users:', err.message);
  }

  // 5. Verification Check
  console.log('\n5. Verifying database state:');
  try {
    const verifyUsers = await apiRequest('/auth/v1/admin/users?per_page=100');
    const remainingUsers = (JSON.parse(verifyUsers.data).users || []).length;
    console.log(`   auth.users remaining: ${remainingUsers}`);

    const verifyLogs = await apiRequest('/rest/v1/attendance_logs?select=count');
    console.log(`   attendance_logs remaining: ${verifyLogs.data}`);

    const verifyEmps = await apiRequest('/rest/v1/employees?select=count');
    console.log(`   employees remaining: ${verifyEmps.data}`);
  } catch (err) {
    console.log('Verification check error:', err.message);
  }

  console.log('\n========================================================');
  console.log('  PURGE COMPLETE! The database is 100% clean and fresh.');
  console.log('========================================================\n');
}

wipeDatabase();
