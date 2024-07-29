const axios = require('axios');
const fs = require('fs');

const url = 'https://automatic.sogni.ai/sdapi/v1';
//const url = 'http://100.79.222.112:7860/sdapi/v1';

function getRandomSeed() {
  return Math.floor(Math.random() * 4294967296);
}

function getCurrentDateTimeWithMilliseconds() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-based
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}`;
}

async function getAvailableModels() {
  try {
    const response = await axios.get(`${url}/sd-models`);
    const modelsAr = response.data;
    return modelsAr.map(m => m.model_name);
  } catch (error) {
    console.error('Error fetching models:', error);
  }
}

async function getAvailableLoras() {
  try {
    const response = await axios.get(`${url}/loras`);
    return response.data.map(m => m.name);
  } catch (error) {
    console.error('Error fetching LoRAs:', error);
  }
}

async function generateImage(prompt, negativePrompt, model, loras = [], seed = getRandomSeed(), batchSize = 1) {
  const startTime = Date.now(); // Start the timer
  const savedFiles = []; // Array to hold the file paths of saved images

  if (seed < 0 || seed > 4294967295) {
    console.error('Error: Seed value must be between 0 and 4294967295');
    return;
  }

  // Include LoRAs in the prompt  <lora:princess_xl_v2:1>
  const loraPrompt = loras.map(lora => `<lora:${lora}:1>`).join(' ');
  const fullPrompt = `${prompt} ${loraPrompt}`.trim();

  try {
    const response = await axios.post(`${url}/txt2img`, {
      prompt: fullPrompt,
      negative_prompt: negativePrompt, // Add negative prompt here
      seed: seed,
      sampler_name: 'Euler a',
      steps: 20,
      width: 512,
      height: 512,
      cfg_scale: 7,
      n_iter: batchSize, // Number of images to generate in a batch
      override_settings: {
        sd_model_checkpoint: model
      }
    });

    const endTime = Date.now(); // End the timer
    const timeTaken = (endTime - startTime) / 1000; // Calculate time taken in seconds

    // Iterate over each generated image
    response.data.images.forEach((imageBase64, index) => {
      // Convert base64 to buffer
      const imageBuffer = Buffer.from(imageBase64, 'base64');

      // Create filename with time, model, seed, and batch index
      const filename = `renders/${model}_${getCurrentDateTimeWithMilliseconds()}_${seed}_${index + 1}.png`;

      // Write the buffer to a file
      fs.writeFileSync(filename, imageBuffer);

      console.log(`Image saved as ${filename}`);
      savedFiles.push(filename); // Add the file path to the array
    });

    console.log(`Total time taken: ${timeTaken.toFixed(2)} seconds`);
    return savedFiles; // Return the array of saved file paths
  } catch (error) {
    console.error('Error generating image:', error);
    return []; // Return an empty array in case of error
  }
}

module.exports = {
  getRandomSeed,
  getAvailableModels,
  getAvailableLoras,
  generateImage,
};

