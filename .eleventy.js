module.exports = function (eleventyConfig) {
  // 11ty doesn't need to copy data files — the build step writes them after 11ty runs.
  // changelog.json is written by convert-changelog.js to src/_data/ and then
  // copied here (it's small and not transformed by the validator).
  eleventyConfig.addPassthroughCopy({ 'src/_data/changelog.json': 'data/changelog.json' });

  // Passthrough: copy JS lib (virtual-timeline is external, not bundled)
  eleventyConfig.addPassthroughCopy({ 'src/js/lib': 'js' });

  // Passthrough: copy media assets
  eleventyConfig.addPassthroughCopy({ 'src/assets': 'assets' });

  // CSS shortcode: inline CSS files in production
  eleventyConfig.addShortcode('inlineCSS', function (files) {
    const fs = require('fs');
    const path = require('path');
    let result = '';
    for (const file of files) {
      const filePath = path.join(__dirname, 'src', 'css', file);
      if (fs.existsSync(filePath)) {
        result += fs.readFileSync(filePath, 'utf-8') + '\n';
      }
    }
    return `<style>\n${result}</style>`;
  });

  // CSS link shortcode: for development mode
  eleventyConfig.addShortcode('linkCSS', function (files) {
    let result = '';
    for (const file of files) {
      result += `<link rel="stylesheet" href="./css/${file}">\n`;
    }
    return result;
  });

  return {
    dir: {
      input: 'src',
      output: 'dist',
      includes: '_includes',
      data: '_data',
    },
  };
};