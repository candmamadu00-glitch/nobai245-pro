// Sirene profissional de despacho de emergência (Web Audio API - sem dependência externa)
class EmergencySirenManager {
  private ctx: AudioContext | null = null;
  private timerId: number | null = null;
  private active = false;
  private muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('nobai245_sos_siren_muted') === '1';
    } catch {}
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public isPlaying(): boolean {
    return this.active;
  }

  public setMuted(mute: boolean) {
    this.muted = mute;
    try {
      localStorage.setItem('nobai245_sos_siren_muted', mute ? '1' : '0');
    } catch {}
    if (mute) {
      this.stopContinuous();
    }
  }

  public playPulse() {
    if (this.muted) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.ctx || this.ctx.state === 'closed') {
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      // Tom duplo profissional estilo viatura / despacho prioritário (Hi-Lo + sweep)
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.linearRampToValueAtTime(1046, now + 0.28);
      osc.frequency.setValueAtTime(740, now + 0.32);
      osc.frequency.linearRampToValueAtTime(1046, now + 0.62);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.22, now + 0.05);
      gain.gain.setValueAtTime(0.22, now + 0.56);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.68);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.7);
    } catch {}
  }

  public startContinuous() {
    if (this.muted || this.active) return;
    this.active = true;
    this.playPulse();
    this.timerId = window.setInterval(() => {
      if (!this.muted && this.active) {
        this.playPulse();
      }
    }, 1150);
  }

  public stopContinuous() {
    this.active = false;
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}

export const emergencySiren = new EmergencySirenManager();
