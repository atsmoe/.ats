const stories = require('./arknightsStories.json');
const chronicle = require('./arknightsChronicle');

module.exports = () => {
  const records = new Map(chronicle().eras.flatMap(era => era.events).map(record => [record.id, record]));
  return stories.map(story => ({
    ...story,
    steps: story.steps.map(step => {
      const record = records.get(step.eventId);
      if (!record) throw new Error(`Story reference missing: ${step.eventId}`);
      return { ...step, record };
    }),
  }));
};
