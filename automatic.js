const axios = require('axios');
const fs = require('fs');

const url = 'http://100.79.222.112:7860';

function getRandomSeed() {
  return Math.floor(Math.random() * 4294967296);
}

function getCurrentDateTimeWithMilliseconds() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}`;
}

async function getAvailableModels() {
  try {
    const response = await axios.get(`${url}/sdapi/v1/sd-models`);
    return response.data.map(m => m.model_name);
  } catch (error) {
    console.error('Error fetching models:', error);
  }
}

async function getAvailableLoras() {
  try {
    const response = await axios.get(`${url}/sdapi/v1/loras`);
    return response.data.map(m => m.name);
  } catch (error) {
    console.error('Error fetching LoRAs:', error);
  }
}

async function getAvailableControlNetModels() {
  try {
    const response = await axios.get(`${url}/controlnet/model_list`);
    //console.log('Available ControlNet Models:', response.data.model_list);
    return response.data.model_list;
  } catch (error) {
    console.error('Error fetching ControlNet models:', error);
    return [];
  }
}

async function generateImage(prompt, negativePrompt, model, loras = [], seed = getRandomSeed(), batchSize = 1) {
  const startTime = Date.now();
  const savedFiles = [];
  const savedMasks = [];

  if (seed < 0 || seed > 4294967295) {
    console.error('Error: Seed value must be between 0 and 4294967295');
    return;
  }

  const loraPrompt = loras.map(lora => `<lora:${lora}:1>`).join(' ');
  const fullPrompt = `${prompt} ${loraPrompt}`.trim();

  try {
    // Generate initial images
    const response = await axios.post(`${url}/sdapi/v1/txt2img`, {
      prompt: fullPrompt,
      seed: seed,
      steps: 4,
      width: 512,
      height: 512,
      cfg_scale: 1,
      n_iter: batchSize,
      scheduler: 'Simple',
      sampler_name: 'Euler',
      override_settings: {
        sd_model_checkpoint: model
      }
    });

    if (!response.data || !response.data.images) {
      console.error('Error: No images returned in response');
      return { images: [], masks: [] };
    }

    const endTime = Date.now();
    const timeTaken = (endTime - startTime) / 1000;

    for (let i = 0; i < response.data.images.length; i++) {
      const imageBase64 = response.data.images[i];
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const filename = `renders/${model}_${getCurrentDateTimeWithMilliseconds()}_${seed}_${i + 1}.png`;

      fs.writeFileSync(filename, imageBuffer);
      console.log(`Image saved as ${filename}`);
      savedFiles.push(filename);
    }

    // Get available ControlNet models
    const controlNetModels = await getAvailableControlNetModels();
    const controlNetModel = controlNetModels.find(m => m.includes('control_v11p_sd15_seg')) || controlNetModels[0];

    if (!controlNetModel) {
      console.warn('Failed to fetch ControlNet models, using default model.');
      controlNetModel = 'control_v11p_sd15_seg [e1f51eb9]'; // Replace with a known model hash
    }

    console.log('Using ControlNet Model:', controlNetModel);

    // Generate masks using ControlNet Segmentation with seg_ofcoco preprocessor
    for (const filePath of savedFiles) {
      const imageBase64 = fs.readFileSync(filePath, 'base64');
      const maskResponse = await axios.post(`${url}/controlnet/detect`, {
        controlnet_module: 'seg_ofade20k',
        controlnet_input_images: [imageBase64],
        controlnet_processor_res: 512,
        controlnet_threshold_a: 64,
        controlnet_threshold_b: 64
      });

      if (!maskResponse.data || !maskResponse.data.images) {
        console.error('Error: No masks returned in response');
        return { images: savedFiles, masks: [] };
      }

      const maskBase64 = maskResponse.data.images[0];
      const maskBuffer = Buffer.from(maskBase64, 'base64');
      const maskFilename = `renders/${model}_${getCurrentDateTimeWithMilliseconds()}_${seed}_${savedMasks.length + 1}_mask.png`;

      fs.writeFileSync(maskFilename, maskBuffer);
      console.log(`Mask saved as ${maskFilename}`);
      savedMasks.push(maskFilename);
    }

    console.log(`Total time taken: ${timeTaken.toFixed(2)} seconds`);
    return { images: savedFiles, masks: savedMasks };
  } catch (error) {
    console.error('Error generating image:', error);
    return { images: [], masks: [] };
  }
}

module.exports = {
  getRandomSeed,
  getAvailableModels,
  getAvailableLoras,
  getAvailableControlNetModels,
  generateImage,
};
