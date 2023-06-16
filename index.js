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
											value: `Human K/D: ${(rows[0].ScpKills / rows[0].HumanDeaths).toFixed(1)}\nSCP K/D: ${(rows[0].HumanKills / rows[0].ScpDeaths).toFixed(1)}\nTotal K/D: ${((rows[0].ScpKills + rows[0].HumanKills) / (rows[0].ScpDeaths + rows[0].HumanDeaths)).toFixed(1)}`,
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
										},
										{
											name: "Total Points",
											value: points,
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
		case "leaderboard": // leaderboard command shows top 10 player points
			await interaction.deferReply();
			// Get top 10 players from `Points` table
			option = interaction.options.get("type").value || "points";
			try {
				const conn = await pool.getConnection();
				switch (option) {
					case "points":
						rows = await conn.query("SELECT * FROM Points ORDER BY Value DESC LIMIT 10");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: rows.map(row => row.Identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by points\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.Value}`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "humankills": // Top 10 human killers
						rows = await conn.query("SELECT * FROM Stats ORDER BY HumanKills DESC LIMIT 10");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: rows.map(row => row.Identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by humans killed\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.Value}`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "scpkills": // Top 10 SCP killers
						rows = await conn.query("SELECT * FROM Stats ORDER BY ScpKills DESC LIMIT 10");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: rows.map(row => row.Identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by SCPs killed\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.Value}`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "escapes": // Top 10 escapees
						rows = await conn.query("SELECT * FROM Stats ORDER BY TimesEscaped DESC LIMIT 10");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: rows.map(row => row.Identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by total escapes\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.Value}`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "fastestescape": // Top 10 fastest escapees, gotta order by ascending this time
						rows = await conn.query("SELECT * FROM Stats ORDER BY FastestEscape ASC LIMIT 10");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: rows.map(row => row.Identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by fastest escape\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.Value}`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "kd": // This time we gotta get and calculate the data ourselves because the database doesn't store it
						rows = await conn.query("SELECT * FROM Stats");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Calculate KD for everyone then sort it and get the top 10, higher means better
							top10 = rows.map(row => {
								const kd = row.HumansKilled / row.ScpKills;
								return {
									kd,
									identifier: row.Identifier
								};
							}
							).sort((a, b) => b.kd - a.kd).slice(0, 10);
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: top10.map(row => row.identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by KD\n${top10.map((row, index) => `${index + 1}. ${names[index]} - ${row.kd}`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "accuracy": // Shot accuracy, higher percentage is better
						rows = await conn.query("SELECT * FROM Stats");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Calculate accuracy for everyone then sort it and get the top 10, higher means better
							top10 = rows.map(row => {
								const accuracy = (row.ShotsFired / row.ShotsHit * 100).toFixed(1);
								return {
									accuracy,
									identifier: row.Identifier
								};
							}
							).sort((a, b) => b.accuracy - a.accuracy).slice(0, 10);
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: top10.map(row => row.identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by accuracy\n${top10.map((row, index) => `${index + 1}. ${names[index]} - ${row.accuracy}%`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "scpitems": // Most SCP items used
						rows = await conn.query("SELECT ScpItemsUsed, Identifier FROM Stats ORDER BY ScpItemsUsed DESC LIMIT 10");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: rows.map(row => row.Identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by SCP items used\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.ScpItemsUsed}`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "throwables": // Most throwable items used, select *, columns of interest are HeGrenadesThrown, FlashbangsThrown, and Scp018sThrown, and GhostLightsThrown
						rows = await conn.query("SELECT HeGrenadesThrown, FlashbangsThrown, Scp018sThrown, GhostLightsThrown, Identifier FROM Stats ORDER BY HeGrenadesThrown + FlashbangsThrown + Scp018sThrown + GhostLightsThrown DESC LIMIT 10");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: rows.map(row => row.Identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by throwable items used\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.HeGrenadesThrown + row.FlashbangsThrown + row.Scp018sThrown + row.GhostLightsThrown}`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "healing": // Self healing items used, select *, columns of interest are MedkitsUsed, AdrenalinesUsed, and PainkillersUsed
						rows = await conn.query("SELECT MedkitsUsed, AdrenalinesUsed, PainkillersUsed, Identifier FROM Stats ORDER BY MedkitsUsed + AdrenalinesUsed + PainkillersUsed DESC LIMIT 10");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: rows.map(row => row.Identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by self healing items used\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.MedkitsUsed + row.AdrenalinesUsed + row.PainkillersUsed}`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "playtime": // Playtime
						rows = await conn.query("SELECT MinutesPlayed, Identifier FROM Stats ORDER BY MinutesPlayed DESC LIMIT 10");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							steamClient.getPlayerSummaries({
								steamids: rows.map(row => row.Identifier.split("@steam")[0]),
								callback: async (status, data) => {
									//console.log(data.response.players);
									names = data.response.players.map(player => player.personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by playtime\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${formatTime(row.MinutesPlayed)}`).join("\n")}`,
										timestamp: new Date(),
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
				}
			} catch (err) {
				console.error(err);
			}
			break
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