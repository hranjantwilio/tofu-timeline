require('dotenv').config();
const express = require('express');
const jsforce = require('jsforce');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');

const { OpenAI } = require("openai");

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
app.post('/asyncgensummary', async (req, res) => {
  try {
    console.log('Request Body:', req.body);
    console.log('Request Body:', JSON.stringify(req.body));
    const accountId = req.body.accountId;
    const queryText = req.body.queryText;
    const assisstantPrompt = req.body.assisstantPrompt;
    const userPrompt = req.body.userPrompt;
    let summaryRecordsMap={};
    if(req.body.summaryMap != undefined) {
        summaryRecordsMap = Object.entries(JSON.parse(data.summaryMap)).map(([key, value]) => ({ key, value }));
        //logger.info(`summaryRecordsMap: ${JSON.stringify(summaryRecordsMap)}`);
    }

    let records = [];
    let groupedData={};    
    console.log('before query');
    // let result = await conn.query(queryText);
    // records.push(...result.records);

    const bulkJob = conn.bulk.query(queryText);



    bulkJob.on("record", (record) => {
        records.push(record);
      });
  
      bulkJob.on("error", (err) => {
        console.error("Bulk Query Error:", err);
      });
  
      bulkJob.on("end", () => {
        console.log(`Bulk Query Completed. Fetched ${records.length} records.`);
        console.log(records); // Use the stored data
      });


    // bulkJob.stream()
    //   .on("record", (record) => {
    //     records.push(record); // Store in JS object
    //   })
    //   .on("error", (err) => {
    //     console.error("Bulk Query Error:", err);
    //   })
    //   .on("end", () => {
    //     console.log("Bulk Query Completed");
    //     console.log(`Fetched ${records.length} records.`);
    //     console.log(records); // Print or use the object as needed
    //   });


    console.log('after query 1'); 
    // while (!result.done) {
    //   result = await conn.queryMore(result.nextRecordsUrl);
    //   records.push(...result.records);
    // }

    console.log('after querymore'); 
    console.log(records); 
    records.forEach(activity => {
        const date = new Date(activity.ActivityDate); // Assuming 'date' is in a valid format
        const year = date.getFullYear();
        const month = date.toLocaleString('en-US', { month: 'long' });

        const key = `${month}`;

        if (!groupedData[year]) {
            groupedData[year] = [];
        }

        // Find the existing month entry or create a new one
        let monthEntry = groupedData[year].find(entry => entry[key]);
        if (!monthEntry) {
            monthEntry = { [key]: [] };
            groupedData[year].push(monthEntry);
        }

        monthEntry[key].push(activity.Description);
    });

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY, // Read from .env
      });

      const assistant = await openai.beta.assistants.create({
        name: "Salesforce Summarizer",
        instructions: "You are an AI that summarizes Salesforce activity data.",
        tools: [{ type: "file_search" }], // Allows using files
        model: "gpt-4-turbo",
    });

    const finalSummary = {};

    const monthMap = {
        january: 0,
        february: 1,
        march: 2,
        april: 3,
        may: 4,
        june: 5,
        july: 6,
        august: 7,
        september: 8,
        october: 9,
        november: 10,
        december: 11
    };
    for (const year in groupedData) {
        //logger.info(`Year: ${year}`);
        finalSummary[year] = {};
        // Iterate through the months inside each year
        for (const monthObj of groupedData[year]) {
            for (const month in monthObj) {
                //logger.info(`  Month: ${month}`);
                const tmpactivites = monthObj[month];
                //logger.info(`  ${month}: ${tmpactivites.length} activities`);
                const monthIndex = monthMap[month.toLowerCase()];
                const startdate = new Date(year, monthIndex, 1);
                const summary = await generateSummary(tmpactivites,openai,assistant,userPrompt.replace('{{YearMonth}}',`${month} ${year}`));
                finalSummary[year][month] = {"summary":summary,"count":tmpactivites.length,"startdate":startdate};
            }
        }
    }

    const createmonthlysummariesinsalesforce = await createTimileSummarySalesforceRecords( finalSummary,accountId,'Monthly',summaryRecordsMap);
    const Quarterlysummary = await generateSummary(finalSummary,openai,assistant,
        `I have a JSON file containing monthly summaries of an account, where data is structured by year and then by month. Please generate a quarterly summary for each year while considering that the fiscal quarter starts in January. The output should be in JSON format, maintaining the same structure but grouped by quarters instead of months. Ensure the summary for each quarter appropriately consolidates the insights from the respective months.
        **Strict Requirements:**
        1. **Summarize all three months into a single quarterly summary. Do not retain individual months as separate keys. The summary should combine key themes, tone, response trends, and follow-up actions from all months within the quarter.
        2. **Return only the raw JSON object** with no explanations, Markdown formatting, or extra characters. Do not wrap the JSON in triple backticks or include "json" as a specifier.
        3. JSON Structure should be: {"year": {"Q1": {"summary":"quarterly summary","count":"total count of all three months of that quarter from JSON file by summing up the count i.e 200","startdate":"start date of the Quarter"}, "Q2": {"summary":"quarterly summary","count":"total count of all three months of that quarter from JSON file by summing up the count ex:- 200 as total count","startdate":"start date of the Quarter"}, ...}}
        4. **Ensure JSON is in minified format** (i.e., no extra spaces, line breaks, or special characters).
        5. The response **must be directly usable with "JSON.parse(response)"**.`);
                        
    //logger.info(`Quarterlysummary received ${JSON.stringify(Quarterlysummary)}`);

    const quaertersums=JSON.parse(Quarterlysummary);

    //const createQuarterlysummariesinsalesforce = await createTimileSummarySalesforceRecords( quaertersums,accountId,'Quarterly',dataApi,logger);
    const createQuarterlysummariesinsalesforce = await createTimileSummarySalesforceRecords( quaertersums,accountId,'Quarterly',summaryRecordsMap);
    /*const uploadResponse = await openai.files.create({
        file: fs.createReadStream(filePath),
        purpose: "assistants", // Required for storage
    });
        
    const fileId = uploadResponse.id;
    logger.info(`File uploaded to OpenAI: ${fileId}`);

    

    const finalSummary=await generateSummaryFromVectorStore(fileId,openai,logger,assisstantPrompt,userPrompt);*/
    
    // Construct the result by getting the Id from the successful inserts
    const callbackResponseBody = {
        summaryDetails: `{"success":"All Quarterly and Monthly based sumaries were created / updated of this account"}`
    };

    const opts = {
        method: 'POST',
        body: JSON.stringify(callbackResponseBody),
        headers: {'Content-Type': 'application/json'}
    }
    
    //const callbackResponse = await org.request(data.callbackUrl, opts);
    //logger.info(JSON.stringify(callbackResponse));
    


    res.send({ success: true, opts });
  } catch (err) {
    res.status(500).send({ success: false, error: err.message });
  }
});


// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

async function generateFile( activities = []) {

    // Get current date-time in YYYYMMDD_HHMMSS format
    const timestamp = new Date().toISOString().replace(/[:.-]/g, "_");
    const filename = `salesforce_activities_${timestamp}.json`;

    const filePath = path.join(__dirname, filename);
    try {
        //const jsonlData = activities.map((entry) => JSON.stringify(entry)).join("\n");
        await fs.writeFile(filePath, JSON.stringify(activities, null, 2), "utf-8");
        //await fs.writeFile(filePath, jsonlData, "utf-8");
        return filePath;
    } catch (error) {
        throw error;
    }
}


async function generateSummary(activities, openai,assistant,userPrompt) 
    {
        
            if (Array.isArray(activities)) 
            {
                if (!activities || activities.length === 0) return null; // Skip empty chunks
            } 
            else if (typeof activities === "object" && activities !== null) 
            {
            }
 
        // Step 1: Generate JSON file
        const filePath = await generateFile(activities);

        // Step 2: Upload file to OpenAI
        const uploadResponse = await openai.files.create({
            file: fs.createReadStream(filePath),
            purpose: "assistants", // Required for storage
        });
            
        const fileId = uploadResponse.id;

        // Step 4: Create a Thread
        const thread = await openai.beta.threads.create();

        // Step 5: Submit Message to Assistant (referencing file)
        const message = await openai.beta.threads.messages.create(thread.id, {
            role: "user",
            content:userPrompt,
                    attachments: [
                        { 
                            file_id: fileId,
                            tools: [{ type: "file_search" }],
                        }
                    ],
                });
            
        //logger.info(`Message sent: ${message.id}`);

        // Step 6: Run the Assistant
        const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
            assistant_id: assistant.id,
        });
            
        //logger.info(`Run started: ${run.id}`);

        const messages = await openai.beta.threads.messages.list(thread.id, {
            run_id: run.id,
          });

          // Log the full response structure
         //logger.info(`OpenAI msg content Response: ${JSON.stringify(messages, null, 2)}`);

          const summary = messages.data[0].content[0].text.value;
          //logger.info(`Summary received ${JSON.stringify(messages.data[0].content[0])}`);
        
          //logger.info(`Summary received ${summary}`);

          const file = await openai.files.del(fileId);

          //logger.info(file);

        return summary.replace(/(\[\[\d+†source\]\]|\【\d+:\d+†source\】)/g, '');

    }

    async function createTimileSummarySalesforceRecords( summaries={},parentId,summaryCategory,summaryRecordsMap) {

        // Create a unit of work that inserts multiple objects.
        //const uow = dataApi.newUnitOfWork();
            
        for (const year in summaries) {
            //logger.info(`Year: ${year}`);
            for (const month in summaries[year]) {
                //logger.info(`Month: ${month}`);
                //logger.info(`Summary:\n${summaries[year][month].summary}\n`);
                let FYQuartervalue=(summaryCategory=='Quarterly')?month:'';
                let motnhValue=(summaryCategory=='Monthly')?month:'';
                let shortMonth = motnhValue.substring(0, 3);
                let summaryValue=summaries[year][month].summary;
                let startdate=summaries[year][month].startdate;
                let count=summaries[year][month].count;
                //  uow.registerCreate({
                //     type: 'Timeline_Summary__c',
                //     fields: {
                //         Parent_Id__c : parentId,
                //         Month__c : motnhValue,
                //         Year__c : year,
                //         Summary_Category__c : summaryCategory,
                //         Summary_Details__c : summaryValue,
                //         FY_Quarter__c : FYQuartervalue,
                //         Month_Date__c:startdate,
                //         Number_of_Records__c:count,
                //         Account__c:parentId
                //     }
                // });



                let summaryMapKey = (summaryCategory=='Quarterly')? FYQuartervalue + ' ' + year : shortMonth + ' ' + year;
                //logger.info(`summaryMapKey: ${summaryMapKey}`);
                //logger.info(`summaryRecordsMap[summaryMapKey]: ${summaryRecordsMap[summaryMapKey]}`);

                let recId = getValueByKey(summaryRecordsMap,summaryMapKey);
                //logger.info(`recId: ${recId}`);
                if(summaryRecordsMap!=undefined && summaryRecordsMap!=null && recId!=null && recId!=undefined)
                {
                    let body ={
                            id : recId,
                            Parent_Id__c : parentId,
                            Month__c : motnhValue,
                            Year__c : year,
                            Summary_Category__c : summaryCategory,
                            Summary_Details__c : summaryValue,
                            FY_Quarter__c : FYQuartervalue,
                            Month_Date__c:startdate,
                            Number_of_Records__c:count,
                            Account__c:parentId
                        };


                        const result = await conn.sobject('Account').update(body);

                }
                else {
                    let body = {
                            Parent_Id__c : parentId,
                            Month__c : motnhValue,
                            Year__c : year,
                            Summary_Category__c : summaryCategory,
                            Summary_Details__c : summaryValue,
                            FY_Quarter__c : FYQuartervalue,
                            Month_Date__c:startdate,
                            Number_of_Records__c:count,
                            Account__c:parentId
                        }
                

                    const result = await conn.sobject('Account').create(body);
                }
                 


            }
        }
        try {
            // Commit the Unit of Work with all the previous registered operations
            //const response = await dataApi.commitUnitOfWork(uow);
            //const result = await conn.sobject('Account').create(body);
        }
        catch (err) {
            const errorMessage = `Failed to insert record. Root Cause : ${err.message}`;
            //logger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }


    function getValueByKey(records, searchKey) {
        const record = records.find(item => item.key === searchKey);
        return record ? record.value : null;
    }