require('dotenv').config();
const express = require('express');
const jsforce = require('jsforce');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(bodyParser.json());

// Salesforce Connection
const conn = new jsforce.Connection({
  loginUrl: "https://test.salesforce.com"
});

// Login to Salesforce
conn.login("hranjan@twilio.com.tofuheroku", "Dhn2024*", (err, userInfo) => {
  if (err) {
    return console.error('Salesforce Login Error:', err);
  }
  console.log('Salesforce Connected:', userInfo.id);
});

// CRUD Operations

// Create Record
app.post('/create', async (req, res) => {
  try {
    const result = await conn.sobject('Account').create(req.body);
    res.send({ success: true, result });
  } catch (err) {
    res.status(500).send({ success: false, error: err.message });
  }
});

// Read Records with Query Pagination using queryMore()
app.get('/accounts', async (req, res) => {
  try {
    let records = [];
    let result = await conn.query("SELECT Id, Name FROM Account");
    records.push(...result.records);

    while (!result.done) {
      result = await conn.queryMore(result.nextRecordsUrl);
      records.push(...result.records);
    }

    res.send({ success: true, records });
  } catch (err) {
    res.status(500).send({ success: false, error: err.message });
  }
});

// Read Activities with Query Pagination using queryMore()
app.get('/activities/:accountId', async (req, res) => {
  try {
    const accountId = req.params.accountId;
    let records = [];
    let queryStr = `SELECT Id, Subject, Description, ActivityDate, Status, Type FROM Task WHERE WhatId = '${accountId}' AND ActivityDate >= LAST_N_YEARS:4 ORDER BY ActivityDate DESC`;
    let result = await conn.query(queryStr);
    records.push(...result.records);

    while (!result.done) {
      result = await conn.queryMore(result.nextRecordsUrl);
      records.push(...result.records);
    }

    res.send({ success: true, records });
  } catch (err) {
    res.status(500).send({ success: false, error: err.message });
  }
});

// Function: Generate File
async function generateFile(data, filename) {
  const filePath = path.join(__dirname, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

// Function: Wait for File Processing (Simulated with Timeout)
async function waitForFileProcessing(fileId) {
  return new Promise(resolve => setTimeout(resolve, 5000));
}

// Function: Group Activities
function groupActivities(activities) {
  return activities.reduce((acc, activity) => {
    const date = new Date(activity.ActivityDate);
    const year = date.getFullYear();
    const month = date.toLocaleString('en-US', { month: 'long' });
    if (!acc[year]) acc[year] = {};
    if (!acc[year][month]) acc[year][month] = [];
    acc[year][month].push(activity);
    return acc;
  }, {});
}

// Function: Create Timeline Summary in Salesforce
async function createTimileSummarySalesforceRecords(records) {
  return await conn.sobject('Timeline_Summary__c').create(records);
}

// Asynchronous Activity Summary Generation
app.post('/asynchactivitysummarygeneration', async (req, res) => {
  try {
    const { accountId, activities } = req.body;
    const groupedActivities = groupActivities(activities);
    const filePath = await generateFile(groupedActivities, 'activities_summary.json');
    await waitForFileProcessing(filePath);
    const summaryRecords = Object.entries(groupedActivities).map(([year, months]) => ({
      AccountId: accountId,
      Year__c: year,
      Summary__c: JSON.stringify(months),
    }));
    const result = await createTimileSummarySalesforceRecords(summaryRecords);
    res.send({ success: true, result });
  } catch (err) {
    res.status(500).send({ success: false, error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
