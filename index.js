const { stdout } = require('process');
const path = require('path');
const fs = require('fs');

const AWS = require('aws-sdk');
const readline = require('readline');
const mime = require('mime-types');

AWS.config.update({
  region: 'eu-west-1'
});

const DIST_PATH = process.argv[2];
const BUCKET_NAME = process.argv[3];
const WAIT_TIMEOUT_MS = 5000;

const s3 = new AWS.S3();

function getBar(percent = 0.5, length = 10) {
  let bar = '';

  for (let i = 0; i < length; i++) {
    bar += i / length <= percent ? '=' : '-';
  }

  return `[${bar}]`;
}

function wait(time = 1000) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

function unnan(number, desiredNumber = 1) {
  return isNaN(number) ? desiredNumber : number;
}

function getCacheControlForFile(filePath) {
  const basename = path.basename(filePath);
  const isIndexFile = basename === 'index.html';
  return isIndexFile ? 'no-cache' : 'max-age=31536000';
}

function getContentTypeForFile(filePath) {
  const type = mime.lookup(path.extname(filePath));
  return type ? type : 'application/octet-stream';
}

function getBuckets() {
  return new Promise((resolve, reject) => {
    s3.listBuckets((err, data) => {
      if (err) {
        return reject(err);
      }

      const buckets = data.Buckets.map((bucket) => bucket.Name);

      resolve(buckets);
    });
  });
}

function getFilesInBucket(bucket) {
  return new Promise((resolve, reject) => {
    s3.listObjects({ Bucket: bucket }, (err, data) => {
      if (err) {
        return reject(err);
      }

      const objects = data.Contents.map((object) => object.Key);

      resolve(objects);
    });
  });
}

function removeObjectFromBucket(bucket, key) {
  return new Promise((resolve, reject) => {
    s3.deleteObject(
      {
        Bucket: bucket,
        Key: key
      },
      (err) => {
        if (err) {
          return reject(err);
        }

        resolve();
      }
    );
  });
}

function uploadFileToBucket(bucket, filePath) {
  return new Promise((resolve, reject) => {
    const basename = path.basename(filePath);
    const uploadOptions = {
      Bucket: bucket,
      Key: basename,
      Body: fs.createReadStream(filePath),
      CacheControl: getCacheControlForFile(filePath),

      // Important if you don't want to download files instead of viewing them
      ContentType: getContentTypeForFile(filePath)
    };

    s3.upload(uploadOptions, (err, data) => {
      if (err) {
        reject(err);
      }
      if (data) {
        resolve(data.Location);
      }
    });
  });
}

async function main() {
  if (!process.argv[2] || !process.argv[3]) {
    stdout.write(`Usage: node deploy.js <dist> <bucket>\n`);

    stdout.write(`\nArguments:\n`);
    stdout.write(
      `<dist>        Location of directory containing the app files\n`
    );
    stdout.write(`<bucket>      Name of the S3 Bucket to upload files to\n`);
    return;
  }

  try {
    const buckets = await getBuckets();

    if (!buckets.includes(BUCKET_NAME)) {
      throw new Error(`Bucket ${BUCKET_NAME} does not exist!`);
    }

    const files = fs.readdirSync(DIST_PATH);

    stdout.write(`Deploy from ${DIST_PATH} to ${BUCKET_NAME}\n`);
    stdout.write(`Files to upload: ${files.length}\n`);
    stdout.write(
      `Starting in ${WAIT_TIMEOUT_MS / 1000} seconds, press Ctrl+C to abort`
    );

    await wait(WAIT_TIMEOUT_MS);

    for (let index in files) {
      const file = files[index];
      const filePath = path.join(DIST_PATH, file);
      const percent = index / files.length;

      await uploadFileToBucket(BUCKET_NAME, filePath);

      stdout.clearLine();
      readline.cursorTo(process.stdout, 0);
      stdout.write(
        `Uploading ${getBar(percent, 30)} ${Math.ceil(percent * 100)}%`
      );
    }

    // Complete the bar. This is useful if there is only 1 file.
    stdout.clearLine();
    readline.cursorTo(process.stdout, 0);
    stdout.write(`Uploading ${getBar(1, 30)} 100%`);

    // Find the difference between objects on the server compared to on the disk.
    const objects = await getFilesInBucket(BUCKET_NAME);
    const unusedFiles = objects.filter((x) => !files.includes(x));

    if (unusedFiles.length) {
      stdout.write(`\nUnused objects to remove: ${unusedFiles.length}\n`);

      for (let index in unusedFiles) {
        const unusedFile = unusedFiles[index];
        const percent = unnan(index / (unusedFiles.length - 1));

        await removeObjectFromBucket(BUCKET_NAME, unusedFile);

        stdout.clearLine();
        readline.cursorTo(process.stdout, 0);
        stdout.write(
          `Cleaning ${getBar(percent, 30)} ${Math.ceil(percent * 100)}%`
        );
      }
    }

    stdout.write('\nDeployed successfully!\n');
  } catch (err) {
    console.error(err);
  }
}

main();
