import React from 'react';
import {render} from 'react-dom';
import fs from 'fs';
import App from './App';
import testData from './data/testData';

import './css/reset.css';
import './css/index.css';

const testHistory = fs.readFileSync(
  __dirname + '/data/testHistory.txt',
  'utf8'
);
let graphData = processGraphData(testHistory);

function processGraphData(rawGraphData) {
  let toInt = str => parseInt(str, 10);
  return rawGraphData
    .trim()
    .split('\n')
    .map((string, index) => {
      console.log(string);
      let [gitHash, dateStr, progress] = string.split(/[\t]/);
      let dateParts = dateStr.split(/[ :-]/).map(toInt);
      let [year, month, day, hours, minutes, seconds] = dateParts;
      let date = new Date(year, month - 1, day, hours, minutes, seconds);
      let timestamp = date.getTime();
      let [passing, total] = progress.split(/\//).map(toInt);
      let percent = parseFloat(((passing / total) * 100).toFixed(1), 10);
      return {
        index,
        gitHash,
        date,
        dateStr,
        timestamp,
        total,
        passing,
        percent,
        x: date,
        y: percent
      };
    });
}

render(
  <App testData={testData} graphData={graphData} />,
  document.getElementById('app')
);
