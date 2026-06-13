module.exports = function (eleventyConfig) {
  // Passthrough: make data files available as static assets for fetch()
  eleventyConfig.addPassthroughCopy({ 'src/_data': 'data' });

  // Passthrough: copy JS lib (virtual-timeline is external, not bundled)
  eleventyConfig.addPassthroughCopy({ 'src/js/lib': 'js' });

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

  // Inline world data filter: serialize object to window.__WORLD_DATA__
  eleventyConfig.addFilter('worldDataScript', function (data) {
    if (!data) return '';
    return '<script>window.__WORLD_DATA__ = ' + JSON.stringify(data) + ';</script>';
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
