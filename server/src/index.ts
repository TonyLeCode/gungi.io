import 'dotenv-safe/config';

import cors from 'cors';
import express from 'express';
import { v4 } from 'uuid';
// import { nanoid } from 'nanoid';

import { InMemorySessionStore, Move, User } from './sessionStore';
import { logoSvg } from './helper';

const PORT = process.env.PORT;
const app = express();
app.use(
	cors({
		origin: process.env.CORS_ORIGIN,
		credentials: true,
	})
);

const http = require('http').Server(app);
const io = require('socket.io')(http, {
	cors: { origin: process.env.CORS_ORIGIN, methods: ['GET', 'POST'] },
	upgradeTimeout: 30000,
	pingInterval: 10000,
	pingTimeout: 60000,
});

const { Gungi } = require('gungi.js-fork');

const main = async () => {
	const sessionStore = new InMemorySessionStore();

	io.use((socket: any, next: any) => {
		const username = socket.handshake.auth.username;
		const gameId = socket.handshake.auth.gameId;
		const userId = socket.handshake.auth.userId;
		console.log("auth:", socket.handshake.auth)
		socket.username = username;
		socket.gameId = gameId;
		socket.userId = userId;
		next();
	});

	io.on('connection', (socket: any) => {
		let users: User[] = [];
		let roomId = '';

		if (!socket.gameId) {
			roomId = v4();

			sessionStore.saveSession(roomId, {
				roomId,
				game: new Gungi(),
				users: [],
				gameStarted: false,
			});
			sessionStore.addUser(roomId, {
				userId: socket.userId,
				username: socket.username,
				userType: 'creator',
			});
		} else {
			// TODO add reconnect here
			const existingRoomId = sessionStore.getCurrentRoom(socket.userId)

			if(!existingRoomId || existingRoomId !== socket.gameId) {
				roomId = socket.gameId;
	
				sessionStore.addUser(roomId, {
					userId: socket.userId,
					username: socket.username,
					userType: 'spectator',
				});
			} else {
				console.log('reconnected')
				roomId = existingRoomId

				// const updatedUsers = sessionStore.getUsers(roomId);
				// io.to(roomId).emit('game', {
				// 	gameState: sessionStore.getGameState(roomId),
				// 	players: updatedUsers,
				// });
			}
		}

		users = sessionStore.getUsers(roomId);
		socket.join(roomId);

		io.to(roomId).emit('roomId', roomId);
		io.to(roomId).emit('users', users);

		socket.on(
			'init_game',
			({ opponentId, roomId }: { opponentId: string; roomId: string }) => {
				// emit game to all clients in room
				const session = sessionStore.findSession(roomId);
				if (session) {
					session.gameStarted = true;
				}
				sessionStore.editUserType(roomId, opponentId, 'opponent');

				const updatedUsers = sessionStore.getUsers(roomId);
				io.to(roomId).emit('game', {
					gameState: sessionStore.getGameState(roomId),
					players: updatedUsers,
				});
			}
		);

		socket.on('spectate_active_game', ({ gameId }: { gameId: string }) => {
			const updatedUsers = sessionStore.getUsers(gameId);
			io.to(roomId).emit('game', {
				gameState: sessionStore.getGameState(gameId),
				players: updatedUsers,
			});
		});

		socket.on(
			'make_move',
			({ roomId, move }: { roomId: string; move: Move }) => {
				sessionStore.makeGameMove(roomId, move);

				if (move.type === 'ready') {
					io.to(roomId).emit('readied', {
						userId: socket.userId,
					});
				}

				// emit updated game to all clients in room
				io.to(roomId).emit('game_updated', {
					gameState: sessionStore.getGameState(roomId),
				});
			}
		);

		socket.on('game_over', ({ forfeit }: { forfeit: boolean }) => {
			const roomId = sessionStore.getCurrentRoom(socket.userId) ?? '';
			const game = sessionStore.getGameState(roomId);
			// destory room and emit event
			sessionStore.destroySession(roomId);

			let message = '';
			if (game?.in_stalemate) {
				message = 'Stalemate';
			} else if (game?.in_checkmate && game.turn === 'b') {
				message = 'White Wins';
			} else if (game?.in_checkmate && game.turn === 'w') {
				message = 'Black Wins';
			} else if (forfeit && game?.turn === 'b') {
				message = 'Black Forfeits';
			} else if (forfeit && game?.turn === 'w') {
				message = 'White Forfeits';
			}

			io.to(roomId).emit('game_over_notification', { message });
		});

		socket.on('disconnect', () => {
			const roomId = sessionStore.getCurrentRoom(socket.userId) ?? '';
			const roomUsers = sessionStore.getUsers(roomId);
			const user = roomUsers.find((x) => x.userId === socket.userId);

			if (user?.userType === 'spectator') {
				// update players and emit event
				sessionStore.removeUser(roomId, socket.userId);
				io.to(roomId).emit('users_updated', {
					users: sessionStore.getUsers(roomId),
				});
			} else {
				if(roomUsers.length == 0){
					// destory room and emit event
					sessionStore.destroySession(roomId);
					io.to(roomId).emit('game_destroyed');
				}
			}
		});
	});

	app.get('/', (_req: any, res: any) => {
		res.send('hello world!');
	});

	app.get('/current_rooms', (_req: any, res: any) => {
		const sessions = sessionStore.findAllSessions();
		res.send(
			sessions.map((x) => {
				return {
					roomId: x.roomId,
					users: x.users,
					gameStarted: x.gameStarted,
				};
			})
		);
	});

	app.get('/shields', (_req: any, res: any) => {
		const sessions = sessionStore.findAllSessions();
		res.send({
			label: 'Gungi.io',
			message: `${sessions.length} active games`,
			logoSvg: logoSvg,
		});
	});

	http.listen(PORT, () => {
		console.log(`🚀 server started at http://localhost:${PORT}.`);
	});
};

main();
