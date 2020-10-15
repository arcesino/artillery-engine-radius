const getTime = () => process.hrtime();

const getDelta = (startTime) => {
  const diff = process.hrtime(startTime);
  return diff[0] * 1e9 + diff[1];
};

module.exports = {
  getTime,
  getDelta
};
