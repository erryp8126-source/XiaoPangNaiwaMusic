export const ANNOUNCEMENT_SEEN_ID_KEY = 'alger_seen_announcement_id';
export const ANNOUNCEMENT_SEEN_VERSION_KEY = 'alger_seen_announcement_version';
export const OPEN_RELEASE_ANNOUNCEMENT_EVENT = 'xiaopang-open-release-announcement';
export const ONBOARDING_STATE_EVENT = 'xiaopang-onboarding-state';
export const ONBOARDING_COMPLETED_EVENT = 'xiaopang-onboarding-completed';

export interface AnnouncementPopupInput {
  isLyricWindow: boolean;
  disclaimerAgreed: boolean;
  isOnboardingActive: boolean;
  justCompletedFreshOnboarding: boolean;
  seenAnnouncementId: string | null | undefined;
  latestAnnouncementId: string;
}

export type AnnouncementPopupReason =
  | 'lyric-window'
  | 'disclaimer-pending'
  | 'onboarding-active'
  | 'fresh-user-onboarding-completed'
  | 'already-seen'
  | 'eligible';

export interface AnnouncementPopupDecision {
  shouldShow: boolean;
  shouldMarkSeenSilently: boolean;
  reason: AnnouncementPopupReason;
}

export interface AnnouncementStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Pure anti-stacking & independent-ID gating policy for startup What's New popups.
 */
export function evaluateAnnouncementPopup(
  input: AnnouncementPopupInput
): AnnouncementPopupDecision {
  if (input.isLyricWindow) {
    return {
      shouldShow: false,
      shouldMarkSeenSilently: false,
      reason: 'lyric-window'
    };
  }

  if (!input.disclaimerAgreed) {
    return {
      shouldShow: false,
      shouldMarkSeenSilently: false,
      reason: 'disclaimer-pending'
    };
  }

  if (input.isOnboardingActive) {
    return {
      shouldShow: false,
      shouldMarkSeenSilently: false,
      reason: 'onboarding-active'
    };
  }

  if (input.justCompletedFreshOnboarding) {
    return {
      shouldShow: false,
      shouldMarkSeenSilently: true,
      reason: 'fresh-user-onboarding-completed'
    };
  }

  const latestId = (input.latestAnnouncementId || '').trim();
  const seenId = (input.seenAnnouncementId || '').trim();

  if (!latestId || seenId === latestId) {
    return {
      shouldShow: false,
      shouldMarkSeenSilently: false,
      reason: 'already-seen'
    };
  }

  return {
    shouldShow: true,
    shouldMarkSeenSilently: false,
    reason: 'eligible'
  };
}

export function markAnnouncementSeen(
  storage: AnnouncementStorageLike | null | undefined,
  announcement: { id: string; version: string }
): void {
  if (!storage) return;
  try {
    if (announcement.id) {
      storage.setItem(ANNOUNCEMENT_SEEN_ID_KEY, announcement.id);
    }
    if (announcement.version) {
      storage.setItem(ANNOUNCEMENT_SEEN_VERSION_KEY, announcement.version);
    }
  } catch {
    // ignore storage quota/security errors in restricted WebViews
  }
}

export function dispatchOpenReleaseAnnouncement(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(OPEN_RELEASE_ANNOUNCEMENT_EVENT));
  } catch {
    // ignore
  }
}
