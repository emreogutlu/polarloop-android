import { useEffect, useState, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  Alert,
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { Device } from './types';

async function requestBLEPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') return true; //buse did it

  if (Platform.OS === 'android') {
    const apiLevel = Platform.Version;

    if (typeof apiLevel === 'number' && apiLevel >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);

      const allGranted = Object.values(results).every(
        result => result === PermissionsAndroid.RESULTS.GRANTED
      );

      if (!allGranted) {
        Alert.alert('Permissions Required', 'Bluetooth and Location permissions are required');
        return false;
      }

      return true;
    }
  }
  else {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  return false;
}

export function usePolarSensor() {
  const { PolarModule } = NativeModules;
  const emitter = PolarModule ? new NativeEventEmitter(PolarModule) : null;

  const [bleState, setBleState] = useState<'PoweredOn' | 'PoweredOff' | 'Unknown'>('PoweredOn');
  const [isPolarStarted, setIsPolarStarted] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<Map<string, Device>>(new Map());
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [isConnecting, setIsConnecting] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [batteryLevel, setBatteryLevel] = useState<number | null>(0);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  async function helloPolar() {
    if (!PolarModule || typeof PolarModule.sayHello !== 'function') {
      Alert.alert('Unavailable', 'Polar SDK is not available on this device');
      return;
    }
    const result = await PolarModule.sayHello();
    console.log(`[INFO] ${result}`);
  }

  async function startPolar(): Promise<boolean> {
    if (!PolarModule) {
      Alert.alert('Error', 'Polar SDK not available on this platform');
      return false;
    }

    try {
      const granted = await requestBLEPermissions();
      if (!granted) return false;

      await PolarModule.initializeSdk();

      setIsPolarStarted(true);
      return true;
    } 
    catch (error) {
      console.error(`[ERROR] Failed to start Polar SDK: ${error}`);
      Alert.alert('Error', 'Failed to initialize Polar SDK');
      return false;
    }
  }

  async function startScan() {
    if (!PolarModule) {
      Alert.alert('Error', 'Polar SDK not available on this platform');
      return;
    }

    if (isScanning) return;

    setScanError(null);
    setIsScanning(true);

    let sdkReady = isPolarStarted;
    if (!sdkReady) {
      sdkReady = await startPolar();
    }

    if (!sdkReady) {
      setIsScanning(false);
      return;
    }

    try {
      await PolarModule.scanForDevice();
    }
    catch (error) {
      setIsScanning(false);
      const message = "Failed to scan for Polar devices";
      setScanError(message);
      console.log(`[ERROR] ${message}`);
    }
  }

  async function stopScan() {
    setIsScanning(false);
    console.log("[INFO] Stopped scanning");
  }


  async function connectToDevice(deviceId: string, isRecovery: boolean = false) {
    if (!PolarModule) return;

    setIsConnecting(deviceId);
    
    try {
      await PolarModule.connectToDevice(deviceId, isRecovery);
      console.log(`[INFO] ${deviceId} connected successfully`);
    } 
    catch (error) {
      console.log("[ERROR] Failed to connect to the device");
    }
  }


  async function disconnectDevice() {
    if (!PolarModule || !connectedDevice) return;

    try {
      await PolarModule.disconnectFromDevice(connectedDevice.id);
    } 
    catch (error) {
      console.log("[ERROR] Failed to disconnect");
    }
  }


  async function startHrStreaming() {
    if (!PolarModule) {
        Alert.alert('Error', 'Polar SDK not available on this platform');
        return;
    }

    try {
        await PolarModule.startHrStreaming();
        console.log(`[INFO] HR streaming started`);
    } 
    catch (error) {
        console.log(`[ERROR] Failed to start HR streaming`);
    }
  }


  useEffect(() => {
    if (!emitter) {
        console.log(`[ERROR] Polar BLE not available - running in simulator or native module not linked`);
        return;
    }

    const foundSub = emitter.addListener('onDeviceFound', (event) => {
      console.log('[INFO] Device found:', event);
       //TODO how to remove undiscovereable devices?
      setDiscoveredDevices(prev => {
        const next = new Map(prev);

        next.set(event.deviceId, {
          id: event.deviceId,
          name: event.name ?? null,
        });

        return next;
      });
    });

    const connectedSub = emitter.addListener('onDeviceConnected', (event) => {
      setIsConnecting(null);
      setConnectedDevice({
        id: event.deviceId,
        name: event.name ?? null,
      });
    });

    const disconnectedSub = emitter.addListener('onDeviceDisconnected', (event) => {
      setConnectedDevice(null);
      setIsConnecting(null);
    });

    const ppiSub = emitter.addListener('onPpiData', (data) => {
      //console.log(`PPI data: ${data}`);
    });

    const hrSub = emitter.addListener('onHrData', (data) => {
      //console.log(new Date().toUTCString());
      //every second I guess?
    });

    const batterySub = emitter.addListener('onBatteryLevel', (data) => {
      setBatteryLevel(data.batteryLevel);
    });

    const ftuSub = emitter.addListener('askFtuConfig', (data) => {
      console.log('[INFO] Sensor asked for FTU config');

      PolarModule.setUserFtuConfig({
         gender: 'MALE',
         birthDate: '2002-01-02',
         height: 175,
         weight: 68,
         maxHeartRate: 196,
         vo2Max: 50, // 15.3 * HR_max / HR_rest
         restingHeartRate: 60,
         trainingBackground: 40,
         deviceTime: new Date().toISOString(),
         typicalDay: 'MOSTLY_SITTING',
         sleepGoalMinutes: 540,
      });
    });

    const recoveredSub = emitter.addListener('onRecoveredPpiData', (data) => {
      console.log(`[INFO] PPI data recovering`);
    });

    const recoveryCompleteSub = emitter.addListener('onPpiRecoveryComplete', (data) => {
      console.log(`[INFO] PPI recovery complete. Recovered data: {sampleCount: ${data.sampleCount}, recordCount: ${data.recordCount}}`);
    });


    return () => {
      foundSub.remove();
      connectedSub.remove();
      disconnectedSub.remove();
      ppiSub.remove();
      hrSub.remove();
      batterySub.remove();
      ftuSub.remove();
      recoveredSub.remove();
      recoveryCompleteSub.remove();
    };
  }, [emitter]);

  /* --- OFFLINE DATA RECOVERY --- */

  const switchToOfflineRecordingMode = async () => {
    console.log(`[INFO] App moved to background`);
    if (PolarModule) {
      PolarModule.startOfflineRecordingForPpi();
    }
  };


  const recoverOfflineDataAndResumeRealtime = async () => {
    console.log(`[INFO] App returned to foreground`);

    if (!PolarModule) {
      console.log(`[WARN] PolarModule not available - skipping offline data recovery`);
      return;
    }

    try {
      await PolarModule.recoverOfflinePpiAndResumeRealtime();
    }
    catch (error) {
      console.log(`[ERROR] FAILED AT recoverOfflinePpiAndResumeRealtime`);
    }
  };


  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', async (nextState) => {
      const previousState = appStateRef.current;

      if (previousState === 'active' && (nextState === 'inactive' || nextState === 'background')) 
        await switchToOfflineRecordingMode();

      if ((previousState === 'inactive' || previousState === 'background') && nextState === 'active') 
        await recoverOfflineDataAndResumeRealtime();

      appStateRef.current = nextState;
    });

    return () => appStateSub.remove();
  });


  const setUserFtuConfig = async (obj : any) => {
    await PolarModule.setUserFtuConfig(obj);
  };


  return {
    emitter,
    helloPolar,
    bleState,
    isPolarStarted,
    isScanning,
    discoveredDevices,
    connectedDevice,
    isConnecting,
    scanError,
    startPolar,
    startScan,
    stopScan,
    connectToDevice,
    disconnectDevice,
    startHrStreaming,
    batteryLevel,
    recoverOfflineDataAndResumeRealtime,
    setUserFtuConfig
  };
}
