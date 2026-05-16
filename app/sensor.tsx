import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useAppColors } from '@/hooks/use-app-colors';
import { usePolarSensor } from '@/hooks/usePolarSensor';
import { usePolarSession } from '@/hooks/usePolarSession';
import { Device } from '@/hooks/types';


const { width } = Dimensions.get('window');
const SENSOR_IMAGE = require('@/assets/images/sensor.png');

/* TODO's
 * Check BLE permissions, I believe there are many unnecessary operations
 * Check scan & connection behavior for multiple devices by the time I receive the watch -> bu yatti gibi ya, multiple device yok
 * Prettify battery information
 * Flush batch array if it overloads the memory?
 * Need to gracefully handle unexpected stream closures
*/

const Sensor: React.FC = () => {
  const colors = useAppColors();
  const [sensorImageFailed, setSensorImageFailed] = useState(false);

  const connectFlowRunningRef = useRef(false);

  const sensor = usePolarSensor();
  const session = usePolarSession({
    connectedDeviceId: sensor.connectedDevice?.id ?? null
  });

  const {
    bleState,
    discoveredDevices,
    connectedDevice,
    isScanning,
    isConnecting,
    scanError,
    batteryLevel
  } = sensor;


  useEffect(() => {
    if (!sensor.emitter) return;

    const ppiSub = sensor.emitter.addListener(
      'onPpiData',
      session.ppiStreaming
    );

    const hrSub = sensor.emitter.addListener(
      'onHrData',
      session.hrStreaming
    );

    const connectRecoverySub = sensor.emitter.addListener(
      'onBatteryLevel',
      async (event) => {
        console.log(`Battery level is sent: ${event.batteryLevel} on ${event.deviceId}`);
        if (!connectFlowRunningRef.current) return;

        try {
          if (event.recoveryInProgress && session.getHasPersistedSession() && session.getPersistedSessionDeviceId() === event.deviceId) {
            console.log('Reconnected, recovering offline PPI');
            await sensor.recoverOfflineDataAndResumeRealtime();
          }
          else {
            console.log('New connection, checking for offline data then starting new session');
            await sensor.recoverOfflineDataAndResumeRealtime();
            await session.startStream(event.deviceId);
          }
        }
        finally {
          connectFlowRunningRef.current = false;
        }
      }
    );

    const recoveredSub = sensor.emitter.addListener('onRecoveredPpiData', session.recoveredPpiStreaming);
    const recoveryCompleteSub = sensor.emitter.addListener('onPpiRecoveryComplete', () => {
      void session.sendPpiBatch();
    });

    const ftuSub = sensor.emitter.addListener('askFtuConfig', async () => {
      console.log('Sensor asked for FTU config');

      try {
        // const ftu = await session.fetchUserFtuConfig(); //TODO remove this

        // await sensor.setUserFtuConfig({
        //   gender: ftu.gender,
        //   birthDate: ftu.birthDate,
        //   height: ftu.height,
        //   weight: ftu.weight,
        //   maxHeartRate: ftu.maxHeartRate,
        //   vo2Max: ftu.vo2Max,
        //   restingHeartRate: ftu.restingHeartRate,
        //   trainingBackground: ftu.trainingBackground,
        //   deviceTime: new Date().toISOString().split('.')[0] + 'Z',
        //   typicalDay: ftu.typicalDay.trim().toUpperCase().replace(/[\s-]+/g, '_'),
        //   sleepGoalMinutes: ftu.sleepGoal,
        // });
      } 
      catch (error) {
        console.log('ERROR: Failed to set FTU config:', error);
      }
    })

    return () => {
      ppiSub.remove();
      hrSub.remove();
      connectRecoverySub.remove();
      recoveredSub.remove();
      recoveryCompleteSub.remove();
      ftuSub.remove();
    };
  }, [sensor.emitter, session.ppiStreaming, session.hrStreaming, session.sendPpiBatch, session.recoveredPpiStreaming, sensor.setUserFtuConfig]);


  const handleConnect = useCallback(async (deviceId: string) => {
    if (connectFlowRunningRef.current) return;
    
    connectFlowRunningRef.current = true;

    try {
      const isRecovery =
        session.getHasPersistedSession() &&
        session.getPersistedSessionDeviceId() === deviceId;

      await sensor.connectToDevice(deviceId, isRecovery);
    } 
    catch (e) {
      console.log('ERROR: Connect flow failed:', e);
      connectFlowRunningRef.current = false;
    }
  }, [sensor, session]);


  useEffect(() => {
    if (connectedDevice) {
      sensor.startHrStreaming().catch((e: any) => {
        if (e?.message?.includes('No device connected')) {
          console.log('startHrStreaming: No device connected, skipping');
          return;
        }
        console.log('ERROR: startHrStreaming failed:', e);
      });
      if (session.getPersistedSessionDeviceId() !== connectedDevice.id) session.startStream(connectedDevice.id);
    }
  }, [connectedDevice]);


  const performDisconnect = useCallback(async () => {
    if (connectFlowRunningRef.current) return;

    connectFlowRunningRef.current = true;

    try {
      await session.stopStream();
      await sensor.disconnectDevice();
      await session.clearPersistedStreamState();
    }
    catch (error) {
      console.log('ERROR: Disconnect flow failed:', error);
    }
    finally {
      connectFlowRunningRef.current = false;
    }
  }, [sensor, session]);


  const handleDisconnect = useCallback(() => {
    if (connectFlowRunningRef.current) return;

    Alert.alert(
      'Stop measurement?',
      'Are you sure you want to stop the current measurement and disconnect the sensor?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: () => {
            void performDisconnect();
          },
        },
      ]
    );
  }, [performDisconnect]);


  const chartGeometry = useMemo(() => {
    if (session.hrChartData.length === 0) return null;

    const chartWidth = 320;
    const chartHeight = 180;

    const paddingLeft = 12;
    const paddingRight = 12;
    const paddingTop = 12;
    const paddingBottom = 24;

    const plotWidth = chartWidth - paddingLeft - paddingRight;
    const plotHeight = chartHeight - paddingTop - paddingBottom;

    const now = Date.now();
    const windowStart = now - session.HR_WINDOW_MS;

    const minHr = Math.min(...session.hrChartData.map((s) => s.hr));
    const maxHr = Math.max(...session.hrChartData.map((s) => s.hr));
    const latestHr = session.hrChartData[session.hrChartData.length - 1].hr;

    const hrRange = Math.max(maxHr - minHr, 1);

    const polylinePoints = session.hrChartData
      .map((sample) => {
        const x =
          paddingLeft +
          ((sample.timestamp - windowStart) / session.HR_WINDOW_MS) * plotWidth;

        const y =
          paddingTop +
          (1 - (sample.hr - minHr) / hrRange) * plotHeight;

        return `${x},${y}`;
      })
      .join(' ');

    return {
      chartWidth,
      chartHeight,
      paddingLeft,
      paddingRight,
      paddingTop,
      plotHeight,
      latestHr,
      minHr,
      maxHr,
      polylinePoints,
    };
  }, [session.hrChartData]);


  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      
      <ScrollView
  showsVerticalScrollIndicator={false}
  contentContainerStyle={{ paddingBottom: 24 }}
>

        {/* ─── CONNECTION STATUS ─── */}
        <View style={[styles.statusRectangle, { backgroundColor: colors.cardBgAlt, shadowColor: colors.shadowColor }]}>
          {connectedDevice ? (
            <View style={styles.connectedStatusRow}>
              <View style={styles.connectedDot} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusTextConnected, { color: colors.textPrimary }]}>
                  Connected to {connectedDevice.name || 'Unknown Device'}
                </Text>
                <Text style={[styles.statusTextConnected, { color: colors.textPrimary }]}>
                  Battery Level: {batteryLevel}%
                </Text>
              </View>
              <TouchableOpacity style={[styles.disconnectBtn, { backgroundColor: colors.destructiveBg }]} onPress={handleDisconnect}>
                <Text style={[styles.disconnectBtnText, { color: colors.destructive }]}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={[styles.statusText, { color: colors.textPrimary }]} numberOfLines={2}>
              You currently don{'\u2019'}t have{'\n'}a connected sensor.
            </Text>
          )}
        </View>

        {/* ─── HR CHART ─── */}
        <View style={[{ backgroundColor: colors.cardBgAlt, shadowColor: colors.shadowColor }]}>
          <View>
            <Text style={[{ color: colors.textPrimary }]}>Live Heart Rate (last 5 min)</Text>
            <Text style={[{ color: colors.textSecondary }]}>
              {chartGeometry ? `❤️ ${Math.round(chartGeometry.latestHr)} bpm` : '-- bpm'}
            </Text>
          </View>

          {chartGeometry ? (
            <Svg width={chartGeometry.chartWidth} height={chartGeometry.chartHeight}>
              {[0, 1, 2, 3, 4].map((lineIndex) => {
                const y = chartGeometry.paddingTop + (lineIndex / 4) * chartGeometry.plotHeight;
                return (
                  <Line
                    key={lineIndex}
                    x1={chartGeometry.paddingLeft}
                    y1={y}
                    x2={chartGeometry.chartWidth - chartGeometry.paddingRight}
                    y2={y}
                    stroke="#DDE4EA"
                    strokeWidth={1}
                  />
                );
              })}

              <Polyline points={chartGeometry.polylinePoints} fill="none" stroke="#5CB89A" strokeWidth={2.5} />

              <SvgText x={chartGeometry.paddingLeft} y={chartGeometry.chartHeight - 8} fontSize={11} fill="#8A94A1">
                -5m
              </SvgText>
              <SvgText
                x={chartGeometry.chartWidth - chartGeometry.paddingRight}
                y={chartGeometry.chartHeight - 8}
                fontSize={11}
                fill="#8A94A1"
                textAnchor="end"
              >
                now
              </SvgText>
            </Svg>
          ) : (
            <View>
              <Text style={[{ color: colors.textMuted }]}>
                Waiting for incoming heart rate samples...
              </Text>
            </View>
          )}

          {chartGeometry && (
            <View>
              <Text style={[{ color: colors.textMuted }]}>Min {Math.round(chartGeometry.minHr)} bpm</Text>
              <Text style={[{ color: colors.textMuted }]}>Max {Math.round(chartGeometry.maxHr)} bpm</Text>
            </View>
          )}
        </View>


        {/* ─── CONNECT SECTION ─── */}
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>Connect with</Text>
          <TouchableOpacity style={[styles.largeWatchCard, { backgroundColor: colors.cardBgAlt, shadowColor: colors.shadowColor }]} activeOpacity={0.9} onPress={sensor.helloPolar}>
            <View style={styles.watchImageWrapper}>
              {sensorImageFailed ? (
                <View style={[styles.sensorImageFallback, { backgroundColor: colors.cardBg }]}>
                  <Ionicons name="watch-outline" size={44} color={colors.textPrimary} />
                </View>
              ) : (
                <Image
                  source={SENSOR_IMAGE}
                  defaultSource={SENSOR_IMAGE}
                  style={styles.largeWatchImage}
                  resizeMode="contain"
                  fadeDuration={0}
                  onError={() => setSensorImageFailed(true)}
                />
              )}
            </View>
            <Text style={[styles.watchLabel, { color: colors.textPrimary }]}>Polar Sensor</Text>
          </TouchableOpacity>
        </View>

        {/* ─── SCAN SECTION ─── */}
        <View style={[styles.scanSection, { backgroundColor: colors.cardBgAlt, shadowColor: colors.shadowColor }]}>
          <View style={styles.scanHeaderRow}>
            <Text style={[styles.sectionLabelInline, { color: colors.textPrimary }]}>Nearby Devices</Text>
            <TouchableOpacity 
              style={[styles.scanButton, isScanning && styles.scanButtonActive]}
              onPress={isScanning ? sensor.stopScan : sensor.startScan}
            >
              {isScanning ? (
                <>
                  <ActivityIndicator size="small" color="#FFF" />
                  <Text style={styles.scanButtonText}>Stop</Text>
                </>
              ) : (
                <>
                  <Ionicons name="bluetooth" size={16} color="#FFF" />
                  <Text style={styles.scanButtonText}>Scan</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {bleState === 'PoweredOff' && (
            <View style={styles.bleWarning}>
              <Ionicons name="warning-outline" size={18} color="#E3C937" />
              <Text style={styles.bleWarningText}>Bluetooth is turned off.</Text>
            </View>
          )}

          {scanError && (
            <View style={styles.bleWarning}>
              <Ionicons name="alert-circle-outline" size={18} color="#FF6B6B" />
              <Text style={[styles.bleWarningText, { color: '#FF6B6B' }]}>{scanError}</Text>
            </View>
          )}

          {isScanning && discoveredDevices.size === 0 && (
            <View style={styles.scanningIndicator}>
              <View style={[styles.bluetoothIconCircle, { backgroundColor: colors.accentLight, borderColor: colors.accentBorder }]}>
                <Ionicons name="bluetooth" size={40} color="#5CB89A" />
              </View>
              <Text style={[styles.scanningText, { color: colors.textPrimary }]}>Looking for Polar sensors...</Text>
              <Text style={[styles.scanningHint, { color: colors.textTertiary }]}>Make sure your sensor is ON.</Text>
            </View>
          )}

          {discoveredDevices.size > 0 && (
            <View style={styles.deviceListContainer}>
              <Text style={[styles.listHeader, { color: colors.textTertiary }]}>FOUND {discoveredDevices.size} DEVICE(S)</Text>
              {Array.from(discoveredDevices.values()).map((device: Device) => (
                <TouchableOpacity 
                  key={device.id} 
                  style={[styles.deviceRow, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      if (connectedDevice?.id === device.id) {
                        handleDisconnect();
                      } else {
                        handleConnect(device.id);
                      }
                    }}
                  disabled={isConnecting !== null}
                >
                  <View style={styles.deviceInfoRow}>
                    {/*<Ionicons name={getSignalIcon(device.rssi)} size={18} color={getSignalColor(device.rssi)} />*/}
                    <View style={styles.deviceTextCol}>
                      <Text style={[styles.deviceNameText, { color: colors.textPrimary }]}numberOfLines={2}>{device.name || 'Unknown Device'}</Text>
                    </View>
                  </View>
                  <View style={styles.deviceActionGroup}>
                    {isConnecting === device.id ? (
                      <ActivityIndicator size="small" color="#5CB89A" />
                    ) : connectedDevice?.id === device.id ? (
                      <View style={[styles.connectedBadge, { backgroundColor: colors.accentLight }]}>
                        <Text style={styles.connectedBadgeText}>Connected</Text>
                      </View>
                    ) : (
                      <View style={[styles.connectBtn, { backgroundColor: colors.accentLight }]}>
                        <Text style={styles.connectBtnText}>Connect</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {!isScanning && discoveredDevices.size === 0 && bleState === 'PoweredOn' && (
            <View style={styles.emptyState}>
              <Ionicons name="bluetooth-outline" size={36} color={colors.textMuted} />
              <Text style={[styles.emptyStateText, { color: colors.textMuted }]}>Tap "Scan" to search for nearby Polar devices.</Text>
            </View>
          )}
        </View>


      </ScrollView>
    </View>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  statusRectangle: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },

  statusText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },

  connectedStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  connectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#5CB89A',
  },

  statusTextConnected: {
    fontSize: 14,
    fontWeight: '500',
  },

  disconnectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },

  disconnectBtnText: {
    fontWeight: '600',
  },

  sectionContainer: {
    margin: 16,
  },

  sectionLabel: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },

  largeWatchCard: {
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },

  watchImageWrapper: {
    width: 110,
    height: 110,
    justifyContent: 'center',
    alignItems: 'center',
  },

  largeWatchImage: {
    width: 110,
    height: 110,
  },

  sensorImageFallback: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
  },

  watchLabel: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: '600',
  },

  scanSection: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },

  scanHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  sectionLabelInline: {
    fontSize: 18,
    fontWeight: '700',
  },

  scanButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#5CB89A',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  scanButtonActive: {
    backgroundColor: '#FF6B6B',
  },

  scanButtonText: {
    color: '#FFF',
    fontWeight: '600',
  },

  bleWarning: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  bleWarningText: {
    fontSize: 14,
    color: '#E3C937',
  },

  scanningIndicator: {
    paddingVertical: 24,
    alignItems: 'center',
  },

  bluetoothIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 10,
  },

  scanningText: {
    fontSize: 15,
    fontWeight: '600',
  },

  scanningHint: {
    marginTop: 4,
    fontSize: 13,
  },

  deviceListContainer: {
    marginTop: 12,
  },

  listHeader: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },

  deviceRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  deviceInfoRow: {
    flex: 1,
  },

  deviceTextCol: {
    flex: 1,
  },

  deviceNameText: {
    fontSize: 15,
    fontWeight: '600',
  },

  deviceActionGroup: {
    marginLeft: 12,
  },

  connectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },

  connectBtnText: {
    color: '#5CB89A',
    fontWeight: '600',
  },

  connectedBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },

  connectedBadgeText: {
    color: '#5CB89A',
    fontWeight: '600',
  },

  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },

  emptyStateText: {
    fontSize: 14,
    textAlign: 'center',
  },
});

export default Sensor;
