import { useCallback, useEffect, useRef, useState } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { PpiSample, HrSample } from './types';

const HR_WINDOW_MS = 5 * 60 * 1000;
const POLAR_STREAM_STATE_KEY = 'polar_stream_state';

type UsePolarSessionParams = {
  connectedDeviceId: string | null
};

type PersistedPolarStreamState = {
  sessionId: string | null;
  sensorTime: number | null;
  sessionDeviceId: string | null;
};

function buildSamplesFromPpis(startTimestamp: number, ppis: number[]): PpiSample[] {
  let currentTime = startTimestamp;
  return ppis.map((ppi) => {
    currentTime += ppi;
    return { timestamp: currentTime, ppi };
  });
}

export function usePolarSession({
  connectedDeviceId
}: UsePolarSessionParams) {

  const [hrChartData, setHrChartData] = useState<HrSample[]>([]);
  const [hrData, setHrData] = useState<number>();

  const sessionIdRef = useRef<string | null>(null);
  const sessionDeviceIdRef = useRef<string | null>(null);
  const sensorTimeRef = useRef<number | null>(null);
  const ppiBufferRef = useRef<PpiSample[]>([]);
  const hrBufferRef = useRef<HrSample[]>([]);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const connectedDeviceIdRef = useRef<string | null>(connectedDeviceId);


  useEffect(() => {
    connectedDeviceIdRef.current = connectedDeviceId;
  }, [connectedDeviceId]);


  const resetSessionState = useCallback(() => {
    sessionIdRef.current = null;
    sessionDeviceIdRef.current = null;
    sensorTimeRef.current = null;
    ppiBufferRef.current = [];
    hrBufferRef.current = [];
    setActiveSessionId(null);
    setHrChartData([]);
  }, []);


  /* --- PPI STREAM --- */

  const ppiStreaming = useCallback((data: { timestamp?: number; ppis: number[] }) => {
    const streamStartTimestamp = sensorTimeRef.current ?? data.timestamp ?? Date.now();
    const samples = buildSamplesFromPpis(streamStartTimestamp, data.ppis);

    if (samples.length === 0) return;

    ppiBufferRef.current.push(...samples);
    sensorTimeRef.current = samples[samples.length - 1].timestamp;
    console.log('[INFO] PPIs:', samples);
  }, []);


  /* --- HR STREAM --- */

  const hrStreaming = useCallback((data: { "hr": number}) => {
    console.log('[INFO] HR:', data);
    if (data.hr == 0) return;

    const now = Date.now();
    const sample = { timestamp: now, hr: data.hr };

    setHrData(data.hr);

    hrBufferRef.current.push(sample);

    setHrChartData((prev) => {
      const next = [...prev, sample];
      return next.filter(item => now - item.timestamp <= HR_WINDOW_MS);
    });
  }, []);


  /* --- BACKEND OPERATIONS --- */

  const startStream = useCallback(async (deviceId: string) => {
    const firstBufferedTimestamp = ppiBufferRef.current[0]?.timestamp;
    const measurementStartTime = firstBufferedTimestamp ?? sensorTimeRef.current ?? Date.now();

    if (!sensorTimeRef.current) {
      sensorTimeRef.current = measurementStartTime;
    }
    
    const sessionId = Crypto.randomUUID();

    sessionIdRef.current = sessionId;
    sessionDeviceIdRef.current = deviceId;

    setActiveSessionId(sessionId);
    
    await persistStreamState();
  }, []);


  const stopStream = useCallback(async () => {
    const sessionId = sessionIdRef.current;

    if (!sessionId) {
      resetSessionState();
      await clearPersistedStreamState();
      return;
    }

    const batch = [...ppiBufferRef.current];

    resetSessionState();
    await clearPersistedStreamState();

    console.log("[INFO] Stream stopped");
  }, [resetSessionState]);


  const ensureActiveSession = useCallback(async (deviceId: string) => {
    if (sessionIdRef.current && sessionDeviceIdRef.current === deviceId) {
      return;
    }

    if (sessionIdRef.current && sessionDeviceIdRef.current && sessionDeviceIdRef.current !== deviceId) {
      await stopStream();
    }

    await startStream(deviceId);
  }, [startStream, stopStream]);
  

  const sendPpiBatch = useCallback(async () => {
    const batch = [...ppiBufferRef.current];
    if (batch.length === 0) return;

    const deviceId = connectedDeviceIdRef.current;
    if (!deviceId) return;

    if (!sessionIdRef.current) {
      await ensureActiveSession(deviceId);
    }

    if (!sessionIdRef.current) return;

    // some backend operation here

    ppiBufferRef.current = ppiBufferRef.current.slice(batch.length);
    await persistStreamState();
  }, [ensureActiveSession]);


  const sendHrBatch = useCallback(async () => {
    const batch = [...hrBufferRef.current];
    if (batch.length === 0) return;

    // some backend operation here

    hrBufferRef.current = hrBufferRef.current.slice(batch.length);
  }, []);


  useEffect(() => {
    const interval = setInterval(() => {
      void sendPpiBatch().catch(error => {
        console.log('ERROR: Periodic PPI upload failed:', error);
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [sendPpiBatch]);


  useEffect(() => {
    const interval = setInterval(() => {
      void sendHrBatch().catch(error => {
        console.log('ERROR: Periodic HR upload failed:', error);
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [sendHrBatch]);


  /* --- FOR RECOVERING OFFLINE DATA --- */

  const recoveredPpiStreaming = useCallback((data: { startTimestamp: number; ppis: number[] }) => {
    const samples = buildSamplesFromPpis(data.startTimestamp, data.ppis);

    if (samples.length === 0) return;

    console.log(
      `[INFO] Recovered PPIs: ${samples.map((sample) => `${sample.ppi}`).join(', ')}`
    );
    
    ppiBufferRef.current.push(...samples);

    const lastTimestamp = samples[samples.length - 1].timestamp;
    if (!sensorTimeRef.current || lastTimestamp > sensorTimeRef.current) {
      sensorTimeRef.current = lastTimestamp;
    }
  }, []);

  async function restorePersistedStreamState() {
    try {
      const raw = await AsyncStorage.getItem(POLAR_STREAM_STATE_KEY);
      if (!raw) return;

      const state: PersistedPolarStreamState = JSON.parse(raw);

      sessionIdRef.current = state.sessionId;
      sensorTimeRef.current = state.sensorTime;
      sessionDeviceIdRef.current = state.sessionDeviceId;
      setActiveSessionId(state.sessionId);

      console.log('[INFO] Restored Polar stream state:', state);
    } 
    catch (error) {
      console.log('[ERROR] Failed to restore Polar stream state:', error);
    }
  }

  async function persistStreamState() {
    try {
      const state: PersistedPolarStreamState = {
        sessionId: sessionIdRef.current,
        sensorTime: sensorTimeRef.current,
        sessionDeviceId: sessionDeviceIdRef.current,
      };
      await AsyncStorage.setItem(POLAR_STREAM_STATE_KEY, JSON.stringify(state));
    } 
    catch (error) {
      console.log('[ERROR] Failed to persist Polar stream state:', error);
    }
  }

  async function clearPersistedStreamState() {
    try {
      await AsyncStorage.removeItem(POLAR_STREAM_STATE_KEY);
    } 
    catch (error) {
      console.log('[ERROR] Failed to clear Polar stream state:', error);
    }
  }

  useEffect(() => {
    void restorePersistedStreamState();
  }, []);

  return {
    HR_WINDOW_MS,
    hrChartData,
    hrData,
    sessionId: sessionIdRef.current,
    ppiStreaming,
    hrStreaming,
    sendPpiBatch,
    startStream,
    stopStream,
    recoveredPpiStreaming,
    clearPersistedStreamState,
    getHasPersistedSession: () => !!sessionIdRef.current,
    getPersistedSessionDeviceId: () => sessionDeviceIdRef.current,
  };
}
