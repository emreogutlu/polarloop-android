export interface Device {
  id: string;
  name: string | null;
  //rssi: number | null; //nevermind
}

export interface PpiSample {
  timestamp: number;
  ppi: number;
}

export interface HrSample {
  timestamp: number;
  hr: number;
}
