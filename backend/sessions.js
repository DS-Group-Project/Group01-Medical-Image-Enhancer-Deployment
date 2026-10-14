import { 
  DynamoDBClient, 
  CreateTableCommand, 
  UpdateTimeToLiveCommand 
} from "@aws-sdk/client-dynamodb";

// Local DynamoDB සඳහා endpoint එකක් දෙන්න (AWS Cloud නම් endpoint ඉවත් කරන්න)
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.DYNAMODB_ENDPOINT || "http://localhost:8000",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "mockAccessKey",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "mockSecretKey"
  }
});

async function setupSessionsTable() {
  try {
    console.log("Creating 'Sessions' table...");

    const createParams = {
      TableName: "Sessions",
      AttributeDefinitions: [
        { AttributeName: "tokenHash", AttributeType: "S" },
        { AttributeName: "familyId", AttributeType: "S" }
      ],
      KeySchema: [
        { AttributeName: "tokenHash", KeyType: "HASH" } // Partition Key
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "FamilyIndex",
          KeySchema: [
            { AttributeName: "familyId", KeyType: "HASH" } // GSI Partition Key
          ],
          Projection: {
            ProjectionType: "ALL"
          }
        }
      ],
      BillingMode: "PAY_PER_REQUEST"
    };

    await client.send(new CreateTableCommand(createParams));
    console.log("Table 'Sessions' with GSI 'FamilyIndex' created successfully!");

    // TTL සකස් කිරීම
    console.log("Enabling TTL on 'expiresAt' attribute...");
    const ttlParams = {
      TableName: "Sessions",
      TimeToLiveSpecification: {
        Enabled: true,
        AttributeName: "expiresAt"
      }
    };

    await client.send(new UpdateTimeToLiveCommand(ttlParams));
    console.log("TTL enabled on 'expiresAt' successfully!");

  } catch (error) {
    if (error.name === "ResourceInUseException") {
      console.log("Table 'Sessions' already exists.");
    } else {
      console.error("Error setting up table:", error);
    }
  }
}

setupSessionsTable();