export const CALSHOW_EPOCH_OFFSET_SECONDS = 978307200;

export const buildCalshowUrl = (date: Date) => {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  const calshowSeconds = unixSeconds - CALSHOW_EPOCH_OFFSET_SECONDS;
  return `calshow:${calshowSeconds}`;
};
