export const QUEST_PHOTO_RETRY_EVENT = "tlvquest:photo-retry";
export const QUEST_PHOTO_APPROVED_EVENT = "tlvquest:photo-approved";

export type QuestPhotoEventDetail = {
  checkpointSlug: string;
};

const dispatchPhotoEvent = (
  name: typeof QUEST_PHOTO_RETRY_EVENT | typeof QUEST_PHOTO_APPROVED_EVENT,
  checkpointSlug: string
) => {
  window.dispatchEvent(
    new CustomEvent<QuestPhotoEventDetail>(name, {
      detail: { checkpointSlug }
    })
  );
};

export const announcePhotoRetry = (checkpointSlug: string) =>
  dispatchPhotoEvent(QUEST_PHOTO_RETRY_EVENT, checkpointSlug);

export const announcePhotoApproved = (checkpointSlug: string) =>
  dispatchPhotoEvent(QUEST_PHOTO_APPROVED_EVENT, checkpointSlug);
