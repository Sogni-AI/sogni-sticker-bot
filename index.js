const url = 'http://100.79.222.112:7860/sdapi/v1';
const axios = require('axios');
const fs = require('fs');

function getRandomSeed() {
  return Math.floor(Math.random() * 4294967296);
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
      const filename = `renders/${model}_${seed}_${timeTaken.toFixed(2)}_${index + 1}.png`;

      // Write the buffer to a file
      fs.writeFileSync(filename, imageBuffer);

      console.log(`Image saved as ${filename}`);
    });

    console.log(`Total time taken: ${timeTaken.toFixed(2)} seconds`);
  } catch (error) {
    console.error('Error generating image:', error);
  }
}

// Define your parameters
const prompt = 'Clouds of color, blue skies, dawn glow, epic, visual motion-illusion, creative rush';
const negativePrompt = 'blurry, low quality, distorted, corner signature, corner logo, comic book, ugly, bad anatomy, disfigured, ugly face, discombobulated, comic strip';
const model = 'zavychromaxl_v70';
const seed = getRandomSeed(); // Initial seed
const loras = []; //['princess_xl_v2', 'realisticVisionV60B1_v51HyperVAE']; // Add your LoRA names here
const batchSize = 10; // Number of images to generate in batch

// Call the function
generateImage(prompt, negativePrompt, model, loras, seed, batchSize);


// Call the functions to get available models and LoRAs
getAvailableModels().then(models => {
  console.log('Available models:', models);
});

getAvailableLoras().then(loras => {
  console.log('Available LoRAs:', loras);
});


