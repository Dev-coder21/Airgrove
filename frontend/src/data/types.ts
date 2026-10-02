/**
 * The single data interface the UI reads. The demo generator, the static JSON export and the
 * live API all produce an `AirData`; nothing else in the frontend knows where data came from.
 *
 * Time is an hourly index 0..hours-1. `now` is the index of the latest available reading;
 * indices after it are forecast hours.
 */
export interface CitySeries {
  id: string;
  name: string;
  lat: number;
  lon: number;
  stations: number;
  /** Forecast-ready (enough history). Others are "observed only". */
  ready: boolean;
  /** Globe label hints: prefer showing this label / place it left of the point. */
  label?: boolean;
  labelLeft?: boolean;
  /** Hourly PM2.5, µg/m³. obs is valid for i <= now; fc/lo/hi (p10/p90) for i >= now. */
  obs: Float32Array;
  fc: Float32Array;
  lo: Float32Array;
  hi: Float32Array;
  /** Hourly weather at the city. */
  windKmh: Float32Array;
  windDir: string[];
  rh: Float32Array;
  mixM: Float32Array;
}

export interface Fire {
  lat: number;
  lon: number;
  /** Hour index of detection. */
  i: number;
  /** Fire radiative power, MW. */
  frp: number;
  /** Flicker phase, decorative. */
  ph: number;
  /** Inside the Punjab & Haryana box (counted in "fires, last 48 h"). Demo: all true. */
  pbhr?: boolean;
}

export interface ModelRow {
  name: string;
  /** MAE for horizons 1–6 h, 7–24 h, 25–72 h. */
  mae: [number, number, number];
  color: string;
  ours?: boolean;
}

export interface AirData {
  source: 'demo' | 'static' | 'api';
  /** Small tag on the time river, e.g. "Sample data". */
  tag: string;
  /** Footer line about the data. */
  footer: string;
  /** Source line on the air card. */
  cardSource: string;
  hours: number;
  now: number;
  /** UTC ms of hour index `now`. */
  nowMs: number;
  /** First city is the default selection. */
  cities: CitySeries[];
  fires: Fire[];
  /** 0..1 crop-smoke index over north India per hour (drives smoke drift and captions). */
  smoke: Float32Array;
  model: ModelRow[];
  /** Model section and card back text, from the backtest. */
  backtest: {
    eyebrow: string;
    scope: string;
    /** Share of real values inside the 80% band (calibrated). */
    coverage: number;
    /** Notes: where it loses, uncertainty, about CAMS. */
    notes: [string, string, string];
    lede: string;
  };
}
