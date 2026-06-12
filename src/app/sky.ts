/**
 * Sun / moon controller: follows the host clock unless the user freezes it to
 * manual via the sun sliders. Owns the stylized day-fraction → sky mapping.
 */
import type { SkyState } from "../render/renderer";
import type { AppState } from "../state";

/** The two render-side sinks a sky update feeds. */
export interface SkySinks {
  setCelestial(sky: SkyState): void;
  setSky(sky: SkyState): void;
}

export interface SkyController {
  /** Push one sky state to lights + environment. */
  applySky(sky: SkyState): void;
  /** Stylized day-fraction → sky mapping (not an ephemeris). */
  skyAtDayFrac(dayFrac: number): SkyState;
  /** Apply the sky for the current wall-clock time. */
  applyClockSky(): void;
}

export const createSkyController = (state: AppState, sinks: SkySinks): SkyController => {
  let applyingClockSun = false;

  const applySky = (sky: SkyState): void => {
    sinks.setCelestial(sky);
    sinks.setSky(sky);
  };

  /** Noon peaks at 62°; the moon mirrors the solar arc at night. */
  const skyAtDayFrac = (dayFrac: number): SkyState => {
    const solarElevation = Math.sin((dayFrac - 0.25) * Math.PI * 2) * 62;
    const moon = solarElevation < 4;
    const bodyFrac = moon ? (dayFrac + 0.5) % 1 : dayFrac;
    const arc = Math.min(1, Math.max(0, (bodyFrac - 0.25) * 2));

    return {
      azimuthDeg: 90 + arc * 180,
      elevationDeg: Math.max(10, moon ? -solarElevation * 0.7 : solarElevation),
      moon,
      dayness: Math.min(1, Math.max(0, (solarElevation + 4) / 16)),
    };
  };

  const skyFromClock = (): SkyState => {
    const now = new Date();
    return skyAtDayFrac((now.getHours() * 60 + now.getMinutes()) / 1440);
  };

  const applyClockSky = (): void => {
    const sky = skyFromClock();

    applyingClockSun = true;
    state.sunAzimuth.set(Math.round(sky.azimuthDeg));
    state.sunElevation.set(Math.round(sky.elevationDeg));
    applyingClockSun = false;

    applySky(sky);
  };

  const applyManualSky = (): void =>
    applySky({
      azimuthDeg: state.sunAzimuth(),
      elevationDeg: state.sunElevation(),
      moon: false,
      dayness: Math.min(1, Math.max(0, (state.sunElevation() - 4) / 26)),
    });

  // Touching a sun slider exits clock mode (the sub also fires for clock-driven
  // writes, hence the applyingClockSun reentrancy latch).
  const onSunSliderInput = (): void => {
    if (applyingClockSun) return;
    if (state.sunMode() === "time") state.sunMode.set("manual");
    else applyManualSky();
  };

  applyingClockSun = true;
  state.sunAzimuth.sub(onSunSliderInput);
  state.sunElevation.sub(onSunSliderInput);
  applyingClockSun = false;

  let clockTimer: ReturnType<typeof setInterval> | undefined;
  state.sunMode.sub((mode) => {
    clearInterval(clockTimer);
    clockTimer = undefined;

    if (mode === "time") {
      applyClockSky();
      clockTimer = setInterval(applyClockSky, 60_000);
    } else {
      applyManualSky();
    }
  });

  return { applySky, skyAtDayFrac, applyClockSky };
};
