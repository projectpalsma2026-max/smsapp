import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  FlatList, 
  StatusBar, 
  Dimensions, 
  Alert,
  Modal,
  ScrollView,
  PermissionsAndroid,
  Platform
} from 'react-native';
import { BlurView } from 'expo-blur';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import * as Network from 'expo-network';
import { useKeepAwake } from 'expo-keep-awake';
import { MotiView, AnimatePresence } from 'moti';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';

// --- CONFIGURATION ---
const SUPABASE_URL = 'https://dftaeukzveskufccpqgs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FIXtJFY25jQUG0Y4YiAvPQ_B3BN_vSg';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SMS_TASK_NAME = 'SMS_RECEIVER_TASK';
const STORAGE_KEY = '@last_transactions';

// Configure Notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// --- BACKGROUND ENGINE ---
TaskManager.defineTask(SMS_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  if (data) {
    const { message, sender } = data;
    if (sender === '192' || sender.includes('192')) {
      const result = await syncToSupabase(sender, message);
      if (result === 'synced') {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "💰 Payment Received!",
            body: `Synced: ${extractAmount(message)} from ${extractPhone(message) || sender}`,
          },
          trigger: null,
        });
      }
    }
  }
});

const extractAmount = (text) => {
  const match = text.match(/\$\s?(\d+\.\d+)/);
  return match ? `$${match[1]}` : 'N/A';
};

const extractPhone = (text) => {
  const match = text.match(/061\d{7}|25261\d{7}/);
  return match ? match[0] : null;
};

const syncToSupabase = async (sender, body) => {
  try {
    const amount = extractAmount(body);
    const phone = extractPhone(body) || sender;

    const { data, error } = await supabase
      .from('received_payments')
      .insert([{ sender_phone: phone, raw_sms: body }])
      .select();

    if (error) throw error;

    await cacheLog({ id: Date.now(), sender: phone, amount, body, status: 'synced', time: new Date().toLocaleTimeString() });
    return 'synced';
  } catch (err) {
    if (err.code === '23505') {
       await cacheLog({ id: Date.now(), sender: extractPhone(body) || sender, amount: extractAmount(body), body, status: 'duplicate', time: new Date().toLocaleTimeString() });
       return 'duplicate';
    }
    await cacheLog({ id: Date.now(), sender: extractPhone(body) || sender, amount: extractAmount(body), body, status: 'failed', time: new Date().toLocaleTimeString() });
    return 'failed';
  }
};

const cacheLog = async (log) => {
  const existing = await AsyncStorage.getItem(STORAGE_KEY);
  const logs = existing ? JSON.parse(existing) : [];
  const updatedLogs = [log, ...logs].slice(0, 10);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLogs));
};

// --- UI COMPONENT ---
export default function App() {
  useKeepAwake();
  const [logs, setLogs] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [hasPermissions, setHasPermissions] = useState(true);
  const [showHowTo, setShowHowTo] = useState(false);

  useEffect(() => {
    checkPermissions();
    loadLogs();
    checkConnection();
    const interval = setInterval(checkConnection, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkPermissions = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
      setHasPermissions(granted);
    }
  };

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
        PermissionsAndroid.PERMISSIONS.READ_SMS,
      ]);
      setHasPermissions(granted['android.permission.RECEIVE_SMS'] === 'granted');
    }
  };

  const checkConnection = async () => {
    const status = await Network.getNetworkStateAsync();
    setIsConnected(status.isConnected && status.isInternetReachable);
  };

  const loadLogs = async () => {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    if (data) setLogs(JSON.parse(data));
  };

  const handleTestSync = async () => {
    setIsSyncing(true);
    const mockBody = `U ruxay $${(Math.random() * 10).toFixed(2)} lambarka 061555${Math.floor(Math.random() * 10000)}. Ref: ${Math.floor(Math.random() * 1000000)}`;
    await syncToSupabase('192', mockBody);
    await loadLogs();
    setIsSyncing(false);
  };

  if (!hasPermissions) {
    return (
      <View style={[styles.container, styles.center]}>
        <MotiView from={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={styles.setupCard}>
          <Feather name="alert-circle" size={60} color="#ffaa00" />
          <Text style={styles.setupTitle}>Setup Required</Text>
          <Text style={styles.setupText}>We need SMS permissions to listen for EVC Plus messages.</Text>
          <TouchableOpacity onPress={requestPermissions} style={styles.grantButton}>
            <Text style={styles.grantButtonText}>Grant Permissions</Text>
          </TouchableOpacity>
        </MotiView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Header with Health Check */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.healthContainer}>
            <View style={[styles.healthDot, { backgroundColor: isConnected ? '#00ff00' : '#ff0000' }]} />
            <Text style={styles.healthText}>{isConnected ? 'SUPABASE LIVE' : 'DISCONNECTED'}</Text>
          </View>
          <TouchableOpacity onPress={() => setShowHowTo(true)}>
            <Feather name="help-circle" size={24} color="#ffffff66" />
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>SMS GATEWAY</Text>
        <Text style={styles.subtitle}>EVC Plus Verification Engine</Text>
      </View>

      <View style={styles.statsContainer}>
        <BlurView intensity={30} tint="dark" style={styles.statBox}>
          <Text style={styles.statLabel}>Sync State</Text>
          <Text style={[styles.statValue, { color: '#00ffff' }]}>WATCHING</Text>
        </BlurView>
        <BlurView intensity={30} tint="dark" style={styles.statBox}>
          <Text style={styles.statLabel}>Source</Text>
          <Text style={styles.statValue}>192 (EVC)</Text>
        </BlurView>
      </View>

      <View style={styles.logsSection}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Sync History</Text>
          <TouchableOpacity onPress={loadLogs}>
            <Feather name="refresh-cw" size={18} color="#00ffff" />
          </TouchableOpacity>
        </View>

        <FlatList
          data={logs}
          renderItem={({ item, index }) => (
            <MotiView
              from={{ opacity: 0, translateX: -20 }}
              animate={{ opacity: 1, translateX: 0 }}
              transition={{ delay: index * 100 }}
              style={styles.logCardContainer}
            >
              <BlurView intensity={20} tint="dark" style={styles.logCard}>
                <View style={styles.logHeader}>
                  <Text style={styles.logSender}>{item.sender}</Text>
                  <View style={[styles.badge, styles[`badge_${item.status}`]]}>
                    <Text style={styles.badgeText}>{item.status.toUpperCase()}</Text>
                  </View>
                </View>
                <View style={styles.logFooter}>
                  <Text style={styles.logAmount}>{item.amount}</Text>
                  <Text style={styles.logTime}>{item.time}</Text>
                </View>
              </BlurView>
            </MotiView>
          )}
          keyExtractor={item => item.id.toString()}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MotiView
                animate={{ translateY: [0, -10, 0] }}
                transition={{ loop: true, duration: 2000 }}
              >
                <MaterialCommunityIcons name="comment-processing-outline" size={80} color="#ffffff22" />
              </MotiView>
              <Text style={styles.emptyText}>Waiting for payments...</Text>
            </View>
          }
        />
      </View>

      {/* No Internet Banner */}
      {!isConnected && (
        <MotiView from={{ translateY: 100 }} animate={{ translateY: 0 }} style={styles.noInternetBanner}>
          <Feather name="wifi-off" size={16} color="#fff" />
          <Text style={styles.noInternetText}>No Internet Connection</Text>
        </MotiView>
      )}

      <View style={styles.footer}>
        <TouchableOpacity onPress={handleTestSync} disabled={isSyncing} style={styles.syncButton}>
          <BlurView intensity={40} tint="dark" style={styles.syncButtonBlur}>
            <Feather name={isSyncing ? "loader" : "zap"} size={20} color="#00ffff" />
            <Text style={styles.syncButtonText}>{isSyncing ? "SYNCING..." : "TEST SYNC"}</Text>
          </BlurView>
        </TouchableOpacity>
      </View>

      {/* How To Modal */}
      <Modal visible={showHowTo} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <BlurView intensity={80} tint="dark" style={styles.modalContent}>
            <Text style={styles.modalTitle}>How to use</Text>
            <ScrollView style={styles.modalScroll}>
              <Text style={styles.modalText}>1. Ensure this app has SMS permissions.</Text>
              <Text style={styles.modalText}>2. Keep the app open or running in the background.</Text>
              <Text style={styles.modalText}>3. The engine automatically listens for '192' messages.</Text>
              <Text style={styles.modalText}>4. Payments are verified instantly in the Hospital System.</Text>
            </ScrollView>
            <TouchableOpacity onPress={() => setShowHowTo(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Got it</Text>
            </TouchableOpacity>
          </BlurView>
        </View>
      </Modal>
    </View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050a14', paddingTop: 60 },
  center: { justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: { alignItems: 'center', marginBottom: 30, paddingHorizontal: 20 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 10 },
  healthContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff0a', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  healthDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8, shadowBlur: 5 },
  healthText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  subtitle: { fontSize: 12, color: '#00ffff', fontWeight: 'bold', opacity: 0.7 },
  statsContainer: { flexDirection: 'row', gap: 15, paddingHorizontal: 20, marginBottom: 30 },
  statBox: { flex: 1, padding: 20, borderRadius: 25, borderWidth: 1, borderColor: '#ffffff11', alignItems: 'center' },
  statLabel: { color: '#ffffff66', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 5 },
  statValue: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  logsSection: { flex: 1, paddingHorizontal: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  logCardContainer: { marginBottom: 12 },
  logCard: { padding: 16, borderRadius: 20, borderWidth: 1, borderColor: '#ffffff11', overflow: 'hidden' },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  logSender: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badge_synced: { backgroundColor: '#00ff0022' },
  badge_failed: { backgroundColor: '#ff000022' },
  badge_duplicate: { backgroundColor: '#ffff0022' },
  badgeText: { fontSize: 10, fontWeight: 'bold', color: '#fff' },
  logFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logAmount: { color: '#00ffff', fontWeight: '900', fontSize: 18 },
  logTime: { color: '#ffffff44', fontSize: 12 },
  emptyContainer: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#ffffff33', marginTop: 20, fontSize: 16, fontWeight: '500' },
  noInternetBanner: { position: 'absolute', bottom: 110, alignSelf: 'center', backgroundColor: '#ff4444', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, gap: 10 },
  noInternetText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  footer: { position: 'absolute', bottom: 40, width: '100%', paddingHorizontal: 20 },
  syncButton: { width: '100%', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#00ffff44' },
  syncButtonBlur: { paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  syncButtonText: { color: '#00ffff', fontWeight: '900', fontSize: 16, letterSpacing: 2 },
  setupCard: { backgroundColor: '#ffffff0a', padding: 30, borderRadius: 30, alignItems: 'center', width: '100%', borderWidth: 1, borderColor: '#ffffff11' },
  setupTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginTop: 20 },
  setupText: { color: '#ffffff66', textAlign: 'center', marginTop: 10, lineHeight: 20 },
  grantButton: { backgroundColor: '#007BFF', paddingHorizontal: 30, paddingVertical: 15, borderRadius: 15, marginTop: 30 },
  grantButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', padding: 20 },
  modalContent: { padding: 30, borderRadius: 30, overflow: 'hidden' },
  modalTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  modalScroll: { maxHeight: 300 },
  modalText: { color: '#ffffffaa', fontSize: 15, marginBottom: 15, lineHeight: 22 },
  closeButton: { backgroundColor: '#ffffff11', paddingVertical: 15, borderRadius: 15, alignItems: 'center', marginTop: 10 },
  closeButtonText: { color: '#00ffff', fontWeight: 'bold' }
});
