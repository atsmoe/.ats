const VERIFIED_PATTERN = /\bverified\b|已核验|完成独立核验/i;
const DISPUTED_PATTERN = /争议|存疑|未核验|降级|重复|错误/i;

export function getWh40kVerificationState(record, excludedIds = new Set()) {
  const explicit = [record?.verificationStatus, record?.sourceStatus, record?.verification?.status]
    .filter(Boolean)
    .join(' ');
  if (excludedIds.has(record?.id) || DISPUTED_PATTERN.test(explicit)) {
    return { code: 'disputed', label: '来源争议 / 复核中' };
  }
  if (VERIFIED_PATTERN.test(explicit)) {
    return { code: 'verified', label: 'VERIFIED' };
  }
  return { code: 'reviewing', label: '逐条复核中' };
}
