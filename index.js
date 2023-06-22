const config = require("./config.json");
const colors = require("colors");
const axios = require("axios");
const steam = require("steam-web");
const fs = require("fs");
// Initialize mariadb connection
const mariadb = require("mariadb");
const pool = mariadb.createPool(config.database);

// Initialize Discord.js
const Discord = require("discord.js");
const client = new Discord.Client({ intents: ["Guilds", "GuildMessages"] });
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
			// throw error with line number
			throw new Error(error.stack);
		}
	})();

	// Hourly #1 user in bot status
	updateStatus = async () => {
		// Get #1 user
		let conn;
		try {
			conn = await pool.getConnection();
			const rows = await conn.query("SELECT * FROM Points ORDER BY Value DESC LIMIT 1");
			if (rows.length === 0) {
				// No users found, dont do anything
				return;
			}
			// Get their username
			let username = "";
			if (rows[0].Identifier.includes("@discord")) {
				// Discord
				username = client.users.cache.get(rows[0].Identifier.split("@discord")[0]).tag;
				client.user.setPresence({ activities: [{ name: `${username} - ${rows[0].Value} points`, type: 3 }], status: "online" });
			} else if (rows[0].Identifier.includes("@steam")) {
				// Steam
				// Lets get their steam username
				// Get steam ID
				let steamID = rows[0].Identifier.split("@steam")[0];
				// Get steam username
				let steamClient = new steam({
					apiKey: config.steam_api_key,
					format: "json"
				});
				let steamUsername = await steamClient.getPlayerSummaries({
					steamids: steamID,
					callback: function (status, data) {
						username = data.response.players[0].personaname;
						console.log(`${colors.cyan("[INFO]")} Setting status to ${username} - ${rows[0].Value} points`)
						client.user.setPresence({ activities: [{ name: `${username} - ${rows[0].Value} points`, type: 3 }], status: "online" });
					}
				});
			}
		} catch (err) {
			throw new Error(err.stack);
		} finally {
			if (conn) conn.end();
		}
	}
	// Run once on startup
	await updateStatus();
	// Run every hour
	setInterval(updateStatus, 3600000);

	// Log startup time in seconds
	console.log(`${colors.cyan("[INFO]")} Startup took ${colors.green((Date.now() - initTime) / 1000)} seconds.`)
});

client.on('messageCreate', async message => {
	if (message.author.bot) return;
	// see if its between may 31st at 4am utc and may 32nd and 4am utc
	const start = new Date("2024-05-31T04:00:00.000Z");
	const end = new Date("2024-06-1T04:00:00.000Z");
	const now = new Date();
	if ((now > start && now < end) || config.fish_react_this_man) {
		// fish react this man
		message.react("🐟");
	}
})

client.on("interactionCreate", async interaction => {
	if (!interaction.isCommand()) return;
	await interaction.deferReply();
	//Load latest quotes.txt, separated by newlines
	let quotes = fs.readFileSync("./quotes.txt", "utf-8").split("\n");
	let connConn = false;
	let conn;
	while (!connConn) { // Loop until we get a connection, I'm too lazy to do it properly, if there even is a proper way
		try {
			conn = await pool.getConnection();
		} catch (err) {
			console.log(`${colors.red("[ERROR]")} Error getting database connection: ${err}`);
			await conn.destroy();
			return;
		}
		connConn = true;
	}
	switch (interaction.commandName) {
		case "statsid":
			// check if identifier has a suffix, if not assume steam
			let ident = interaction.options.getString("identifier");
			if (!ident.includes("@")) {
				ident += "@steam";
			}
			// Get stats from database
			try {
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
								if (!data.response) {
									interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
									throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
								}
								username = data.response.players[0].personaname;
								const embed = {
									color: 0x0099ff,
									title: `${username}'s Stats`,
									description: `## Total Points: ${points}`,
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
											value: `${rows[0].MedkitsUsed + rows[0].PainkillersUsed + rows[0].AdrenalinesUsed + rows[0].Scp500SUsed}`,
											inline: true
										},
										{
											name: "SCP Items Used",
											value: rows[0].ScpItemsUsed + rows[0].Scp500SUsed,
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
									footer: {
										// Random quote
										text: quotes[Math.floor(Math.random() * quotes.length)]
									}
								};
								await interaction.editReply({ embeds: [embed] });
							}
						});
					}

				}
			} catch (err) {
				throw new Error(err.stack);
			} finally {
				if (conn) conn.end();
			}
			break;
		case "stats": // Get stats via discord user
			// Check if they're trying to check the bot stats
			if (interaction.options.getUser('user').id === client.user.id) {
				return interaction.reply("What are you doing? I don't have stats!");
			}
			// See if the user from the interaction is in the AccountLinks table
			try {
				const [accrows] = await conn.query("SELECT * FROM AccountLinks WHERE discord_id = ?", [interaction.options.getUser('user').id]);
				console.log(accrows)
				if (!accrows) {
					await interaction.editReply({
						content: "That user hasn't linked their account yet!",
						components: [
							{
								type: 1,
								components: [
									{
										type: 2,
										label: "Link Account",
										style: 5,
										url: "https://link.mydickdoesnt.work/"
									}
								]
							}
						]
					});
				} else {
					// check if identifier has a suffix, if not assume steam
					let ident = `${accrows.steam_id}@steam`
					// Get stats from database
					try {
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
										if (!data.response) {
											interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
											throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
										}
										username = data.response.players[0].personaname;
										const embed = {
											color: 0x0099ff,
											title: `${username}'s Stats`,
											description: `## Total Points: ${points}`,
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
											footer: {
												// Random quote
												text: quotes[Math.floor(Math.random() * quotes.length)]
											}
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
				}
			} catch (err) {
				console.log(err);
			} finally {

				if (conn) conn.end();
			}
			break;
		case "link": // Send link account button
			interaction.reply({
				content: "Click the button below to link your account!",
				components: [
					{
						type: 1,
						components: [
							{
								type: 2,
								label: "Link Account",
								style: 5,
								url: "https://link.mydickdoesnt.work/"
							}
						]
					}
				]
			})
			break;

		case "leaderboard": // Leaderboard command
			option = interaction.options.getString("type") || "points";
			try {

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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by points\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.Value}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "humankills":
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by humans killed\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.HumanKills}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "scpkills":
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by SCPs killed\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.ScpKills}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "humandeaths": // Most deaths as human
						rows = await conn.query("SELECT * FROM Stats ORDER BY HumanDeaths DESC LIMIT 10");
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by deaths as a human\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.HumanDeaths}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "scpdeaths": // Most deaths as human
						rows = await conn.query("SELECT * FROM Stats ORDER BY ScpDeaths DESC LIMIT 10");
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by deaths as an SCP\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.ScpDeaths}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "kd":
						rows = await conn.query("SELECT *, ( CASE WHEN ((HumanDeaths + ScpDeaths) = 0) THEN (HumanKills + ScpKills) ELSE (HumanKills + ScpKills)/(HumanDeaths + ScpDeaths) END ) AS KD FROM Stats ORDER BY KD DESC LIMIT 10;");
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by best total K/D ratio\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${new Number(row.KD).toFixed(1)}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "escapes":
						rows = await conn.query("SELECT * FROM Stats ORDER BY TimesEscaped ASC LIMIT 10");
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by most escapes\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.TimesEscaped}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "fastestescape":
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by most escapes\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${formatSeconds(row.FastestEscape)}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "scpitems":
						rows = await conn.query("SELECT *, (ScpItemsUsed + Scp500SUsed) AS Total FROM Stats ORDER BY ScpItems DESC LIMIT 10");
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by most SCP items used\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.ScpItems}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "healingitems":
						rows = await conn.query("SELECT *, (MedkitsUsed + AdrenalinesUsed + PainkillersUsed + Scp500SUsed) AS Total FROM Stats ORDER BY Total DESC LIMIT 10");
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by most healing items used\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.Total}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "throwables":
						rows = await conn.query("SELECT *, (FlashbangsThrown + HeGrenadesThrown + Scp018sThrown + GhostLightsThrown) AS Total FROM Stats ORDER BY Total DESC LIMIT 10");
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by most throwable items used\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.Total}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "playtime":
						rows = await conn.query("SELECT * FROM Stats ORDER BY MinutesPlayed DESC LIMIT 10");
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by most time played\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${formatTime(row.MinutesPlayed)}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								}
							})
						}
						break;
					case "accuracy": // Get top 10 players by accuracy ((ShotsHit / r.ShotsFired) * 100)
						rows = await conn.query("SELECT *, (ShotsHit / ShotsFired) * 100 AS Accuracy FROM playerstats.Stats WHERE ShotsFired > 500 ORDER BY Accuracy DESC LIMIT 10");
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
									if (!data.response) {
										interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
										throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
									}
									//console.log(data.response.players);
									names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by best shot accuraccy\n### **Only players with over 500 fired rounds will appear here!**\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${new Number(row.Accuracy).toFixed(1)}%`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								},
							})
						}
						break;
					case "zombiekills": // Get top 10 players by zombie kills
						rows = await conn.query("SELECT * FROM Stats ORDER BY KillsAsZombie DESC LIMIT 10");
						if (rows.length === 0) {
							await interaction.editReply({ content: "No stats found.", ephemeral: true });
						} else {
							// Get their names
							const steamClient = new steam({
								apiKey: config.steam_api_key,
								format: "json"
							});
							let names = [];
							// create an indexed array of identifiers
							identifiers = rows.map(row => row.Identifier);

							// seperate the steam and northwood identifiers
							steamIdentifiers = identifiers.filter(identifier => identifier.split("@")[1] === "steam");
							northwoodIdentifiers = identifiers.filter(identifier => identifier.split("@")[1] === "northwood");

							console.log(steamIdentifiers);
							console.log(northwoodIdentifiers);

							steamClient.getPlayerSummaries({
								steamids: rows.map(row => row.Identifier.split("@steam")[0]),
								callback: async (status, data) => {
									if(row.Identifier.split("@northwood")[1] === "@northwood") {
										// gotta handle northwood staff differently
										names = rows.map(row => row.Identifier.split("@northwood")[0]);

									} else {
										// Steam users
										if (!data.response) {
											interaction.editReply({ content: "An error occured while getting the user's steam profile. [Steam could be down](<https://steamstat.us>), please try again later!" });
											throw new Error("stats command, steamClient.getPlayerSummaries callback, data.response is undefined, is the steam API down?");
										}
										//console.log(data.response.players);
										names = rows.map(row => data.response.players.find(player => player.steamid === row.Identifier.split("@steam")[0]).personaname);
									}
									//console.log(names);
									const embed = {
										color: 0x0099ff,
										description: `## Top 10 players by most kills as zombie\n${rows.map((row, index) => `${index + 1}. ${names[index]} - ${row.KillsAsZombie}`).join("\n")}`,
										timestamp: new Date(),
										footer: {
											// Random quote
											text: quotes[Math.floor(Math.random() * quotes.length)]
										}
									};
									await interaction.editReply({ embeds: [embed] });
								},
							})
						}
						break;

				}
			} catch (err) {
				await interaction.editReply({ content: "An error occured.", ephemeral: true });
				throw new Error(err.stack);
			} finally {
				await conn.end();
			}

			break;
		case "tip": // Get a random tip (quotes)
			await interaction.editReply({ content: quotes[Math.floor(Math.random() * quotes.length)], });
			break;
	}
	if (conn) await conn.end();
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
const error_webhook = new Discord.WebhookClient({ url: config.error_webhook });
// Catch-All error handler, I'm lazy

process.on('uncaughtException', async (err) => {
	await console.log(`${colors.red("[ERROR]")} Uncaught Exception: ${err}`);
	// Hit the webhook with the error
	await error_webhook.send({
		embeds: [{
			title: "Uncaught Exception",
			// full stack trace
			description: `\`\`\`${err.stack}\`\`\``,
			color: 0xff0000,
			timestamp: new Date(),
			footer: {
				text: "I shat myself ;-;"
			}
		}]
	});

});

process.on('unhandledRejection', async (err) => {
	await console.log(`${colors.red("[ERROR]")} Unhandled Rejection: ${err}`);
	// Hit the webhook
	await error_webhook.send({
		embeds: [{
			title: "Unhandled Rejection",
			description: `\`\`\`${err.stack}\`\`\``,
			color: 0xff0000,
			timestamp: new Date(),
			footer: {
				text: "I shat myself ;-;"
			}
		}]
	})
});

console.log(`${colors.cyan("[INFO]")} Starting...`)
// Start timer to see how long startup takes
const initTime = Date.now();
// Login to Discord
client.login(config.discord.token);

// Chris was here :)