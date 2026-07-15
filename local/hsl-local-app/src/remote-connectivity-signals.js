function classifyMembershipConnectivitySignal(membership) {
  if (Number.isInteger(membership?.response?.httpStatus)) {
    return "reachable";
  }

  if (membership?.status === "unknown" && !membership?.response && membership?.request?.url) {
    return "transport-failure";
  }

  return "none";
}

module.exports = {
  classifyMembershipConnectivitySignal,
};
