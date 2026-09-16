const stories = require('./arknightsStories.json');
const chronicle = require('./arknightsChronicle');

function resolveStories(storyList, recordList) {
  const records = new Map(recordList.map(record => [record.id, record]));
  const storyIds = new Set();
  const eventIds = new Set();
  return storyList.map(story => {
    if (storyIds.has(story.id)) throw new Error(`Duplicate story: ${story.id}`);
    storyIds.add(story.id);
    if (!story.steps?.length) throw new Error(`Story has no steps: ${story.id}`);
    const steps = story.steps.map(step => {
      if (eventIds.has(step.eventId)) throw new Error(`Duplicate story reference: ${step.eventId}`);
      eventIds.add(step.eventId);
      const record = records.get(step.eventId);
      if (!record) throw new Error(`Story reference missing: ${step.eventId}`);
      return { ...step, record };
    });
    return { ...story, steps };
  });
}

module.exports = () => resolveStories(stories, chronicle().eras.flatMap(era => era.events));
module.exports.resolveStories = resolveStories;
