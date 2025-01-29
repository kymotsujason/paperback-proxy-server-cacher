require("dotenv").config(); // Load environment variables from .env file

const fs = require("fs");
const path = require("path");
const axios = require("axios"); // Used for HTTP requests to other sites
const cheerio = require("cheerio"); // Used for HTML parsing
const JSZip = require("jszip");
const CryptoJS = require("crypto-js"); // For decryption in batoto
const puppeteer = require("puppeteer"); // For handling Cloudflare protection

// Create a write stream to a log file
const logFilePath = path.join(process.cwd(), "debug.log");
const logFile = fs.createWriteStream(logFilePath, { flags: "a" });

// Create a write stream to a error file
const errorFilePath = path.join(process.cwd(), "error.log");
const errorFile = fs.createWriteStream(errorFilePath, { flags: "a" });

// Save the original console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Override console.log
console.log = function (...args) {
	// Write to the terminal
	originalConsoleLog.apply(console, args);

	// Format the message and write to the log file
	const message = formatLogMessage("INFO", args);
	logFile.write(message + "\n");
};

// Override console.error
console.error = function (...args) {
	// Write to the terminal
	originalConsoleError.apply(console, args);

	// Format the message and write to the log file
	const message = formatLogMessage("ERROR", args);
	errorFile.write(message + "\n");
};

// Function to format the log message with a timestamp and log level
function formatLogMessage(level, args) {
	const timestamp = new Date().toISOString();
	const message = args
		.map((arg) =>
			typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg
		)
		.join(" ");
	return `[${timestamp}] [${level}] ${message}`;
}

// Ensure the log file is closed when the process exits
process.on("exit", () => {
	logFile.end();
});

process.on("SIGINT", () => {
	logFile.end();
	process.exit();
});

process.on("uncaughtException", (err) => {
	console.error("Uncaught Exception:", err);
	logFile.end();
	process.exit(1);
});

/**
 * Sanitize a filename by removing dashes, underscores, and spaces, and converting to lowercase.
 * @param {string} filename - The filename to sanitize.
 * @returns {string} - The sanitized filename.
 */
function sanitizeFilename(filename) {
	return filename.replace(/[\s_\-]/g, "").toLowerCase();
}

/**
 * Sanitize the sourceId by removing dashes, underscores, and spaces, trimming, and converting to lowercase.
 * @param {string} sourceId - The sourceId to sanitize.
 * @returns {string} - The sanitized sourceId.
 */
function sanitizeSourceId(sourceId) {
	return sourceId
		.toLowerCase()
		.replace(/[\s_\-]/g, "")
		.trim();
}

/**
 * Find a file in the directory that contains "paperbackarchive" after sanitization.
 * @param {string} directory - The directory to search in.
 * @returns {string|null} - The path to the found file, or null if not found.
 */
function findPaperbackArchiveFile(directory) {
	const files = fs.readdirSync(directory);
	for (const file of files) {
		const sanitizedFilename = sanitizeFilename(file);
		if (sanitizedFilename.includes("paperbackarchive")) {
			const filePath = path.join(directory, file);
			if (fs.lstatSync(filePath).isFile()) {
				return filePath;
			}
		}
	}
	return null;
}

/**
 * Split an array into chunks of a specified size.
 * @param {Array} array - The array to split.
 * @param {number} chunkSize - The size of each chunk.
 * @returns {Array[]} - An array of chunks.
 */
function chunkArray(array, chunkSize) {
	const results = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		results.push(array.slice(i, i + chunkSize));
	}
	return results;
}

/**
 * Load cache from a JSON file if it exists, otherwise return an empty object.
 * @param {string} cacheFilePath - The path to the cache file.
 * @returns {Object} - The cache object.
 */
function loadCache(cacheFilePath) {
	if (fs.existsSync(cacheFilePath)) {
		const data = fs.readFileSync(cacheFilePath, "utf-8");
		return JSON.parse(data);
	}
	return {};
}

/**
 * Save cache to a JSON file.
 * @param {string} cacheFilePath - The path to the cache file.
 * @param {Object} cache - The cache object to save.
 */
function saveCache(cacheFilePath, cache) {
	fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), "utf-8");
}

(async () => {
	// Initialize Puppeteer browser (used for batoto)
	const browser = await puppeteer.launch({ headless: true });
	const cacheFilePath = path.join(process.cwd(), "cache.json");
	let cache = loadCache(cacheFilePath); // Load cache from file

	try {
		// Step 1: Find the "paperbackarchive" file in the current directory
		const archiveFilePath = findPaperbackArchiveFile(process.cwd());
		if (!archiveFilePath) {
			console.error("No paperbackarchive file found in the directory.");
			process.exit(1);
		}

		// Step 2: Read the zip file
		const zipData = fs.readFileSync(archiveFilePath);
		const zip = new JSZip();

		// Load the zip file in memory
		const zipContent = await zip.loadAsync(zipData);

		// Step 3: Find the "sourcemanga" file inside the zip archive
		let sourceMangaFile = null;

		for (const filename of Object.keys(zipContent.files)) {
			const sanitizedFilename = sanitizeFilename(filename);
			if (sanitizedFilename.includes("sourcemanga")) {
				sourceMangaFile = filename;
				break;
			}
		}

		if (!sourceMangaFile) {
			console.error("No sourcemanga file found in the zip archive.");
			process.exit(1);
		}

		// Step 4: Read and parse the JSON content of the "sourcemanga" file
		const sourceMangaContent = await zipContent
			.file(sourceMangaFile)
			.async("string");
		const sourceMangaJson = JSON.parse(sourceMangaContent);
		// Assuming sourceMangaJson is an object with entries as properties

		// Step 5: Process each entry with rate limiting and caching
		await processEntries(sourceMangaJson, browser, cache, cacheFilePath);
	} catch (err) {
		console.error("Error:", err);
	} finally {
		// Close the Puppeteer browser
		await browser.close();

		// Save the cache to the file
		saveCache(cacheFilePath, cache);
	}
})();

/**
 * Process each entry in the JSON with rate limiting and caching.
 * @param {Object} entriesObj - The JSON object containing entries to process.
 * @param {Object} browser - The Puppeteer browser instance.
 * @param {Object} cache - The cache object to use and update.
 */
async function processEntries(entriesObj, browser, cache, cacheFilePath) {
	const entryKeys = Object.keys(entriesObj);
	for (let i = 0; i < entryKeys.length; i++) {
		const key = entryKeys[i];
		const entry = entriesObj[key];

		if (!entry) continue; // Skip if entry is undefined or null

		// Sanitize sourceId
		let sourceId = entry.sourceId;
		if (!sourceId) continue; // Skip if sourceId is missing
		sourceId = sanitizeSourceId(sourceId);

		// Skip entries where sourceId is 'toonily' or 'anilist'
		if (sourceId === "toonily" || sourceId === "anilist") {
			continue;
		}

		// Initialize cache structure for sourceId and mangaId if not present
		if (!cache[sourceId]) cache[sourceId] = {};
		if (!cache[sourceId][entry.mangaId])
			cache[sourceId][entry.mangaId] = {};

		// Now proceed to fetch chapters and process them
		try {
			let chapters = [];

			if (sourceId === "mangadex") {
				// Base URL for Mangadex API
				let baseUrl = `https://api.mangadex.org/manga/${entry.mangaId}/feed?limit=500&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic&translatedLanguage[]=en`;
				let offset = 0;
				let hasResults = true;

				// Loop to handle pagination, increasing offset by 500 each time
				while (hasResults) {
					let url = `${baseUrl}&offset=${offset}`;

					// Headers for Mangadex requests (only Referer header)
					let headers = {
						Referer: "https://api.mangadex.org", // Referer being the website itself
						// Removed Authorization header from this request
					};

					const response = await axios.get(url, { headers: headers });
					const data = response.data;

					// Check if results are returned
					if (data.data && data.data.length > 0) {
						console.log(
							`Mangadex results for mangaId ${entry.mangaId} at offset ${offset}:`,
							data.data.length
						);

						// Iterate over the results from data.data
						for (const chapter of data.data) {
							if (chapter.type === "chapter") {
								chapters.push(chapter.id);
							}
						}

						// Increase offset by 500 for the next request
						offset += 500;
					} else {
						// No more results, exit the loop
						hasResults = false;
						console.log(
							`No more results for mangaId ${entry.mangaId} at offset ${offset}.`
						);
					}

					// Rate limiting: wait for 1 second before making the next API request
					await new Promise((resolve) => setTimeout(resolve, 250));
				}
			} else if (sourceId === "weebcentral") {
				// Fetch chapters
				const baseUrl = "https://weebcentral.com";
				let url = `${baseUrl}/series/${entry.mangaId}/full-chapter-list`;

				let headers = {
					Referer: baseUrl,
				};

				const response = await axios.get(url, { headers: headers });
				const $ = cheerio.load(response.data);

				const arrChapters = $("a.flex.items-center").toArray();
				for (const chapterObj of arrChapters) {
					const chapterHref = $(chapterObj).attr("href");
					if (!chapterHref) continue;

					const chapterId = chapterHref
						.replace(/\/$/, "")
						.split("/")
						.pop();
					if (!chapterId) continue;

					chapters.push(chapterId);
				}
			} else if (sourceId === "manganato") {
				// Fetch chapters
				const baseUrl = "https://manganato.com";
				const mangaUrl = entry.mangaId;
				let headers = {
					Referer: baseUrl,
				};

				const mangaResponse = await axios.get(mangaUrl, {
					headers: headers,
				});
				const $ = cheerio.load(mangaResponse.data);

				const chapterListSelector =
					"div.panel-story-chapter-list ul.row-content-chapter li," +
					"div.manga-info-chapter div.chapter-list div.row";
				const chapterElements = $(chapterListSelector).toArray();

				for (const chapter of chapterElements) {
					const chapterId = $("a", chapter).attr("href") ?? "";
					if (!chapterId) continue;

					chapters.push(chapterId);
				}
			} else if (sourceId === "batoto") {
				// Fetch chapters using Puppeteer
				const baseUrl = "https://batocomic.org";
				const mangaUrl = `${baseUrl}/series/${entry.mangaId}`;
				const page = await browser.newPage();

				await page.setUserAgent(
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
						"AppleWebKit/537.36 (KHTML, like Gecko) " +
						"Chrome/91.0.4472.114 Safari/537.36"
				);
				await page.setExtraHTTPHeaders({
					Referer: baseUrl,
				});

				await page.goto(mangaUrl, { waitUntil: "networkidle2" });
				const mangaContent = await page.content();
				const $ = cheerio.load(mangaContent);

				const chapterElements = $(
					"div.episode-list div.main .item"
				).toArray();

				for (const chapter of chapterElements) {
					const chapterId =
						$("a", chapter)
							.attr("href")
							?.replace(/\/$/, "")
							?.split("/")
							.pop() ?? "";
					if (!chapterId) continue;

					chapters.push(chapterId);
				}

				await page.close();
			}

			// Process each chapter
			for (const chapterId of chapters) {
				// Check if chapterId exists in the cache
				if (cache[sourceId][entry.mangaId][chapterId]) {
					console.log(
						`Skipping already processed chapter ${chapterId} for mangaId ${entry.mangaId} from sourceId ${sourceId}`
					);
					continue; // Skip processing this chapter
				}

				try {
					if (sourceId === "mangadex") {
						// Process the chapter as before
						console.log(
							`Processing chapter ${chapterId} for mangaId ${entry.mangaId} from sourceId ${sourceId}`
						);

						// Combine process.env.SITE with "/manga?chapterId=" and chapter.id
						let chapterUrl = `${process.env.SITE}/manga?chapterId=${chapterId}`;

						// Headers for chapter request
						let chapterHeaders = {
							Referer: process.env.SITE, // Referer being the website itself
							Authorization: `Bearer ${process.env.TOKEN}`, // Moved Authorization header here
						};

						const chapterResponse = await axios.get(chapterUrl, {
							headers: chapterHeaders,
						});

						// Check that response.data.failedImages array is empty
						if (
							chapterResponse.data.failedImages &&
							chapterResponse.data.failedImages.length === 0
						) {
							console.log(
								`Chapter ${chapterId} is successfully downloaded for mangaId ${entry.mangaId} from sourceId ${sourceId}`
							);
							cache[sourceId][entry.mangaId][chapterId] = true;
						} else {
							console.error(
								`Chapter ${chapterId} has failed images:`,
								chapterResponse.data.failedImages
							);
							cache[sourceId][entry.mangaId][chapterId] = false;
						}
					} else if (sourceId === "weebcentral") {
						// Process the chapter as before
						console.log(
							`Processing chapter ${chapterId} for mangaId ${entry.mangaId} from sourceId ${sourceId}`
						);

						const baseUrl = "https://weebcentral.com";

						let headers = {
							Referer: baseUrl,
						};

						// Construct the new URL: baseUrl + "/chapters/" + chapterId + "/images?reading_style=long_strip"
						let chapterUrl = `${baseUrl}/chapters/${chapterId}/images?reading_style=long_strip`;

						// Perform axios.get on this combined URL, including referer in headers
						const chapterResponse = await axios.get(chapterUrl, {
							headers: headers,
						});

						// Load response.data into cheerio
						const $$ = cheerio.load(chapterResponse.data);

						// Extract image URLs
						const pages = [];

						const imgElems = $$(
							"img",
							"section.cursor-pointer"
						).toArray();
						for (const img of imgElems) {
							let image = $$(img).attr("src") || "";
							if (!image) image = $$(img).attr("data-src") || "";
							if (!image) continue;
							pages.push(image.replace("?undefined", ""));
						}

						// Split pages into chunks to limit URL length
						const maxImagesPerRequest = 10; // Adjust this value as needed
						const pagesChunks = chunkArray(
							pages,
							maxImagesPerRequest
						);

						cache[sourceId][entry.mangaId][chapterId] = true;
						for (const chunk of pagesChunks) {
							// Process the image URLs in the chunk into an acceptable query URL string
							let params = "?";
							for (const imageUrl of chunk) {
								params += `imageUrls=${imageUrl}&`;
							}
							params = params.slice(0, -1); // Remove the trailing '&'

							// Combine process.env.SITE with "/generic" and the params
							let combinedUrl = `${process.env.SITE}/generic${params}`;

							// Headers for the request
							let genericHeaders = {
								Referer: process.env.SITE,
								Authorization: `Bearer ${process.env.TOKEN}`,
							};

							// Use axios.get on the combined URL
							const genericResponse = await axios.get(
								combinedUrl,
								{
									headers: genericHeaders,
								}
							);

							// Check that response.data.failedImages array is empty
							if (
								genericResponse.data.failedImages &&
								genericResponse.data.failedImages.length === 0
							) {
								console.log(
									`Chapter ${chapterId} chunk processed successfully.`
								);
							} else {
								console.error(
									`Chapter ${chapterId} has failed images:`,
									genericResponse.data.failedImages
								);
								cache[sourceId][entry.mangaId][
									chapterId
								] = false;
							}

							// Rate limiting: wait for 1 second before processing the next chunk
							await new Promise((resolve) =>
								setTimeout(resolve, 100)
							);
						}
					} else if (sourceId === "manganato") {
						// Process the chapter as before
						console.log(
							`Processing Manganato chapter ${chapterId}`
						);

						const baseUrl = "https://manganato.com";
						let headers = {
							Referer: baseUrl,
						};

						// axios.get the chapterId (which is a URL)
						const chapterResponse = await axios.get(chapterId, {
							headers: headers,
						});
						const $$ = cheerio.load(chapterResponse.data);

						// Use provided code to get the image URLs
						const pages = [];
						const chapterImagesSelector =
							"div.container-chapter-reader img";
						const imgElements = $$(chapterImagesSelector).toArray();

						for (const img of imgElements) {
							let image = $$(img).attr("src") ?? "";
							if (!image) image = $$(img).attr("data-src") ?? "";
							if (!image)
								throw new Error(
									`Unable to parse image(s) for Chapter ID: ${chapterId}`
								);
							pages.push(image);
						}

						// Split pages into chunks to limit URL length
						const maxImagesPerRequest = 10; // Adjust this value as needed
						const pagesChunks = chunkArray(
							pages,
							maxImagesPerRequest
						);
						cache[sourceId][entry.mangaId][chapterId] = true;

						for (const chunk of pagesChunks) {
							// Process the image URLs in the chunk into an acceptable query URL string (don't encode the URLs)
							let params = "?";
							for (const imageUrl of chunk) {
								params += `imageUrls=${imageUrl.replace(
									"?undefined",
									""
								)}&`;
							}
							params = params.slice(0, -1); // Remove the trailing '&'

							// Combine process.env.SITE with "/generic" and the params
							let combinedUrl = `${process.env.SITE}/generic${params}`;

							// Headers for the request
							let genericHeaders = {
								Referer: process.env.SITE,
								Authorization: `Bearer ${process.env.TOKEN}`,
							};

							// Use axios.get on the combined URL
							const genericResponse = await axios.get(
								combinedUrl,
								{
									headers: genericHeaders,
								}
							);

							// Check that response.data.failedImages array is empty
							if (
								genericResponse.data.failedImages &&
								genericResponse.data.failedImages.length === 0
							) {
								console.log(
									`Manganato Chapter ${chapterId} chunk processed successfully.`
								);
							} else {
								console.error(
									`Manganato Chapter ${chapterId} has failed images:`,
									genericResponse.data.failedImages
								);
								cache[sourceId][entry.mangaId][
									chapterId
								] = false;
							}

							// Rate limiting: wait for 1 second before processing the next chunk
							await new Promise((resolve) =>
								setTimeout(resolve, 100)
							);
						}
					} else if (sourceId === "batoto") {
						// Process the chapter using Puppeteer
						console.log(`Processing Batoto chapter ${chapterId}`);

						// Combine "https://batocomic.org/chapter/" with chapterId
						const chapterUrl = `${baseUrl}/chapter/${chapterId}`;

						// Use Puppeteer to navigate to the chapter page
						await page.goto(chapterUrl, {
							waitUntil: "networkidle2",
						});
						const chapterContent = await page.content();
						const $$ = cheerio.load(chapterContent);

						// Extract image URLs using provided code

						// Find the script containing 'batoPass' and 'batoWord'
						const scriptObj = $$("script")
							.toArray()
							.find((obj) => {
								const data = obj.children[0]?.data ?? "";
								return (
									data.includes("batoPass") &&
									data.includes("batoWord")
								);
							});
						const scriptContent =
							scriptObj?.children[0]?.data ?? "";

						// Extract batoPass, batoWord, imgHttps from the scriptContent
						const batoPassMatch = scriptContent.match(
							/const\s+batoPass\s*=\s*(.*?);/
						);
						const batoWordMatch = scriptContent.match(
							/const\s+batoWord\s*=\s*"(.*?)";/
						);
						const imgHttpsMatch = scriptContent.match(
							/const\s+imgHttps\s*=\s*(.*?);/
						);

						if (
							!batoPassMatch ||
							!batoWordMatch ||
							!imgHttpsMatch
						) {
							throw new Error(
								`Unable to find required variables in script for chapter ${chapterId}`
							);
						}

						// Evaluate batoPass (it's a JavaScript expression)
						let batoPass;
						try {
							batoPass = eval(batoPassMatch[1]).toString();
						} catch (error) {
							throw new Error(
								`Error evaluating batoPass: ${error.message}`
							);
						}

						const batoWord = batoWordMatch[1];
						const imgHttps = imgHttpsMatch[1];

						// Parse imgList and tknList
						const imgList = JSON.parse(imgHttps);
						const decrypted = CryptoJS.AES.decrypt(
							batoWord,
							batoPass
						).toString(CryptoJS.enc.Utf8);
						const tknList = JSON.parse(decrypted);

						// Combine imgList and tknList to get full image URLs
						const pages = imgList.map((value, index) => {
							const token = tknList[index] ?? "";
							return `${value}?${token}`;
						});

						// Split pages into chunks to limit URL length
						const maxImagesPerRequest = 10; // Adjust this value as needed
						const pagesChunks = chunkArray(
							pages,
							maxImagesPerRequest
						);
						cache[sourceId][entry.mangaId][chapterId] = true;

						for (const chunk of pagesChunks) {
							// Process the image URLs in the chunk into an acceptable query URL string (don't encode the URLs)
							let params = "?";
							for (const imageUrl of chunk) {
								params += `imageUrls=${imageUrl.replace(
									"?undefined",
									""
								)}&`;
							}
							params = params.slice(0, -1); // Remove the trailing '&'

							// Combine process.env.SITE with "/generic" and the params
							let combinedUrl = `${process.env.SITE}/generic${params}`;

							// Headers for the request
							let genericHeaders = {
								Referer: process.env.SITE,
								Authorization: `Bearer ${process.env.TOKEN}`,
							};

							// Use axios.get on the combined URL
							const genericResponse = await axios.get(
								combinedUrl,
								{
									headers: genericHeaders,
								}
							);

							// Check that response.data.failedImages array is empty
							if (
								genericResponse.data.failedImages &&
								genericResponse.data.failedImages.length === 0
							) {
								console.log(
									`Batoto Chapter ${chapterId} chunk processed successfully.`
								);
							} else {
								console.error(
									`Batoto Chapter ${chapterId} has failed images:`,
									genericResponse.data.failedImages
								);
								cache[sourceId][entry.mangaId][
									chapterId
								] = false;
							}

							// Rate limiting: wait for 1 second before processing the next chunk
							await new Promise((resolve) =>
								setTimeout(resolve, 100)
							);
						}
					}
				} catch (error) {
					console.error(
						`Error processing chapter ${chapterId} for mangaId ${entry.mangaId} from sourceId ${sourceId}:`,
						error.message
					);
				}

				// Save the cache to the file
				saveCache(cacheFilePath, cache);

				// Rate limiting: wait for 1 second before processing the next chapter
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		} catch (error) {
			console.error(
				`Error processing mangaId ${entry.mangaId} from sourceId ${sourceId}:`,
				error.message
			);
			continue; // Skip to the next entry if there's an error
		}

		// Save the cache to the file
		saveCache(cacheFilePath, cache);

		// Rate limiting: wait for 1 second before processing the next entry
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}
