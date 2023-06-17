const config = require("./config.json");
const colors = require("colors");
const axios = require("axios");
const steam = require("steam-web");
// Initialize mariadb connection
const mariadb = require("mariadb");
const pool = mariadb.createPool(config.database);

// Initialize Discord.js
const Discord = require("discord.js");
const client = new Discord.Client({ intents: ["Guilds"] });
const rest = new Discord.REST({
	version: '10'
}).setToken(config.discord.token);

const formatTime = (time) => {
	// weeks days hours minutes, input is minutes, if a value is 0 it will not be included
	weeks = Math.floor(time / 10080);
	days = Math.floor((time % 10080) / 1440);
	hours = Math.floor(((time % 10080) % 1440) / 60);
	minutes = Math.floor(((time % 10080) % 1440) % 60);
	output = "";
	if (weeks > 0) {
		output += `${weeks} week${weeks > 1 ? "s" : ""} `;
	}
	if (days > 0) {
		output += `${days} day${days > 1 ? "s" : ""} `;
	}
	if (hours > 0) {
		output += `${hours} hour${hours > 1 ? "s" : ""} `;
	}
	if (minutes > 0) {
		output += `${minutes} minute${minutes > 1 ? "s" : ""} `;
	}
	return output;
}

const formatSeconds = (seconds) => {
	// Same as above but for seconds, output hours minutes seconds only
	hours = Math.floor(seconds / 3600);
	minutes = Math.floor((seconds % 3600) / 60);
	seconds = Math.floor((seconds % 3600) % 60);
	output = "";
	if (hours > 0) {
		output += `${hours} hour${hours > 1 ? "s" : ""} `;
	}
	if (minutes > 0) {
		output += `${minutes} minute${minutes > 1 ? "s" : ""} `;
	}
	if (seconds > 0) {
		output += `${seconds} second${seconds > 1 ? "s" : ""} `;
	}
	return output;
}

function calculateKD(kills, deaths) {
	if (deaths === 0) {
		return kills;
	} else if (kills === 0) {
		return 0;
	} else {
		return (kills / deaths).toFixed(2);
	}
}

client.on("ready", async () => {
	console.log(`${colors.cyan("[INFO]")} Logged in as ${colors.green(client.user.tag)}`)
	// Load Commands
	console.log(`${colors.cyan("[INFO]")} Loading Commands...`)
	await (async () => {
		try {
			const commands = require("./commands.json");
			console.log(`${colors.cyan("[INFO]")} Registering Commands...`)
			let start = Date.now()
			await rest.put(
				Discord.Routes.applicationCommands(client.user.id), {
				body: commands
			},
			);
			console.log(`${colors.cyan("[INFO]")} Successfully registered commands. Took ${colors.green((Date.now() - start) / 1000)} seconds.`);
		} catch (error) {
			console.error(error);
		}
	})();

	// Log startup time in seconds
	console.log(`${colors.cyan("[INFO]")} Startup took ${colors.green((Date.now() - initTime) / 1000)} seconds.`)
});

client.on("interactionCreate", async interaction => {
	if (!interaction.isCommand()) return;
	switch (interaction.commandName) {
		case "stats":
			await interaction.deferReply();
			// check if identifier has a suffix, if not assume steam
			let ident = interaction.options.getString("identifier");
			if (!ident.includes("@")) {
				ident += "@steam";
			}
			// Get stats from database
			let conn;
			try {
				conn = await pool.getConnection();
				const rows = await conn.query("SELECT * FROM Stats WHERE Identifier = ?", [ident]);
				if (rows.length === 0) {
					await interaction.editReply({ content: "No stats found for that identifier.", ephemeral: true });
				} else {
					// Get points from `Points` table
					points = await conn.query("SELECT Value FROM Points WHERE Identifier = ?", [ident]);
					if (points.length === 0) {
						points = 0;
					} else {
						points = points[0].Value;
					}
					// Lets get their username, identifiers are their user ID for their respective platform suffexed with either @discord or @steam to say which platform it is
					let username = "";
					if (rows[0].Identifier.includes("@discord")) {
						// Discord
						username = client.users.cache.get(rows[0].Identifier.split("@discord")[0]).tag;
						// Just gonna ignore this for now as 99.99% of players are on steam
					} else if (rows[0].Identifier.includes("@steam")) {
						// Steam
						// Lets get their steam username
						const steamClient = new steam({
							apiKey: config.steam_api_key,
							format: "json"
						});
						const steamID = rows[0].Identifier.split("@steam")[0];
						await steamClient.getPlayerSummaries({
							steamids: steamID,
							callback: async (status, data) => {

								username = data.response.players[0].personaname;
								const embed = {
									color: 0x0099ff,
									title: `${username}'s Stats`,
									description: `## Points: ${points}`,
									url: `https://steamcommunity.com/profiles/${steamID}`,
									author: {
										name: "SCP:SL Stats"
									},
									thumbnail: {
										url: data.response.players[0].avatarfull
									},
									fields: [
										{
											name: 'Kills',
											value: `Killed Humans: ${rows[0].HumanKills}\nKilled SCPs: ${rows[0].ScpKills}\nTotal Kills: ${rows[0].ScpKills + rows[0].HumanKills}`,
											inline: true
										},
										{
											name: 'Deaths',
											value: `Deaths as Human: ${rows[0].HumanDeaths}\nDeaths as SCP: ${rows[0].ScpDeaths}\nTotal Deaths: ${rows[0].ScpDeaths + rows[0].HumanDeaths}`,
											inline: true
										},
										{
											name: 'K/D Ratio',
											// Cut off to the first decimal place
											//value: `${(rows[0].ScpKills + rows[0].HumanKills) / (rows[0].ScpDeaths + rows[0].HumanDeaths)}`,
											//value: `${((rows[0].ScpKills + rows[0].HumanKills) / (rows[0].ScpDeaths + rows[0].HumanDeaths)).toFixed(1)}`,
											value: `Human K/D: ${calculateKD(rows[0].HumanKills, rows[0].HumanDeaths)}\nSCP K/D: ${calculateKD(rows[0].ScpKills, rows[0].ScpDeaths)}\nTotal K/D: ${calculateKD(rows[0].ScpKills + rows[0].HumanKills, rows[0].ScpDeaths + rows[0].HumanDeaths)}`,
											inline: true
										},
										{
											name: 'Total Shots Fired',
											value: `${rows[0].ShotsFired}`,
											inline: true
										},
										{
											name: 'Total Hits',
											value: `${rows[0].ShotsHit}`,
											inline: true
										},
										{
											name: 'Accuracy',
											// Cut off to the first decimal place
											//value: `${(rows[0].ShotsHit / rows[0].ShotsFired) * 100}%`,
											value: `${((rows[0].ShotsHit / rows[0].ShotsFired) * 100).toFixed(1)}%`,
											inline: true
										},
										{
											name: "Throwables Used",
											value: `${rows[0].FlashbangsThrown + rows[0].HeGrenadesThrown + rows[0].Scp018sThrown + rows[0].GhostLightsThrown}`,
											inline: true
										},
										{
											name: "Healing Items Used",
											value: `${rows[0].MedkitsUsed + rows[0].PainkillersUsed + rows[0].AdrenalinesUsed}`,
											inline: true
										},
										{
											name: "SCP Items Used",
											value: rows[0].ScpItemsUsed,
											inline: true
										},
										{
											name: "Total Playtime",
											// get from rows.MinutesPlayed, and calculate days hours and minutes
											value: formatTime(rows[0].MinutesPlayed),
											inline: true
										},
										{
											name: "Total Escapes",
											value: `${rows[0].TimesEscaped}`,
											inline: true
										},
										{
											name: "Fastest Escape",
											// If total escapes is 0, set to N/A, otherwise calculate time, value is in seconds with decimal places
											value: `${rows[0].TimesEscaped === 0 ? "N/A" : formatSeconds(rows[0].FastestEscape)}`,
											inline: true
										}
									],
									timestamp: new Date(),
								};
								await interaction.editReply({ embeds: [embed] });
							}
						});
					}

				}
			} catch (err) {
				console.log(err);
			} finally {
				if (conn) conn.end();
			}
			break;
	}
});

process.on('SIGINT', async () => {
	await console.log(`${colors.cyan("[INFO]")} Stop received, exiting...`);
	await client.user.setPresence({
		status: "invisible",
		activities: []
	});
	await client.destroy();
	await console.log(`${colors.cyan("[INFO]")} Goodbye!`);
	process.exit(0);
});

console.log(`${colors.cyan("[INFO]")} Starting...`)
// Start timer to see how long startup takes
const initTime = Date.now();
// Login to Discord
client.login(config.discord.token);