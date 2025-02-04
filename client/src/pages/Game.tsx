import React, { useEffect, useRef, useState } from 'react';
import { RouteComponentProps, useParams } from 'react-router';
import { io } from 'socket.io-client';
import { Lobby } from 'src/components/game/Lobby';
import { GameState, Move, User } from 'src/typings/types';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

import { GungiGame } from '../components/game/GungiGame';
import { Login } from '../components/game/Login';
import { nanoid } from 'nanoid';

// function UserIdSessionHook(){
// 	const [userId, setUserId] = useState('');
// 	// const setUserIdSession = (value:string) => {sessionStorage.setItem('userId',value)}
// 	useEffect(() => {
// 		const temp = sessionStorage.getItem('userId')
// 		if(temp){
// 			setUserId(temp)
// 		} else {
// 			const newId = nanoid()
// 			sessionStorage.setItem('userId', newId)
// 			setUserId(newId)
// 		}
// 	}, []);
// 	// return [userId, setUserIdSession] as const
// 	return userId
// }

function userIdSession(): string{
	const userId = localStorage.getItem('userId')
	if(userId){
		return userId
	} else {
		const temp = nanoid()
		localStorage.setItem('userId', temp)
		return temp
	}
}

export const Game: React.FC<RouteComponentProps> = ({ history }) => {
	document.title = 'Play | Gungi.io';

	const { current: socket } = useRef(
		io(`${process.env.REACT_APP_API_URL}`, {
			autoConnect: false,
			timeout: 60000,
		})
	);
	const [username, setUsername] = useState('');
	const params: any = useParams();
	const gameId = params.id;
	const [state, setState] = useState<'login' | 'lobby' | 'game'>('login');
	const [roomId, setRoomId] = useState('');
	const [readied, setReadied] = useState<string[]>([]);
	const [players, setPlayers] = useState<User[] | undefined>(undefined);
	const [gameState, setGameState] = useState<GameState | undefined>(undefined);
	const [shouldConnect, setShouldConnect] = useState(false);
	// const [userId, setUserId] = UserIdSessionHook();
	const userId = userIdSession();
	const swal = withReactContent(Swal);

	const chooseName = () => {
		setShouldConnect(true);
		if (gameId) {
			setRoomId(gameId);
		} else {
			// console.log(window.location.href)
			// console.log(roomId)
			// window.history.pushState(null, '', window.location.href + '/' + roomId)
		}

		fetch(`${process.env.REACT_APP_API_URL}/current_rooms`)
			.then((response) => response.json())
			.then((data) => {
				const room = data.find((x: any) => x.roomId === gameId);
				if (!room && gameId) {
					history.push('/NotFound');
					return;
				}
				if (room?.gameStarted) {
					//@ts-ignore
					// sets socket.handshake.gameId on backend
					socket.auth = { username, gameId, userId };
					socket.connect();
					socket.emit('spectate_active_game', { gameId });
				} else {
					setState('lobby');
				}
			});
	};

	const startGame = (opponentId: string) => {
		socket.emit('init_game', { opponentId, roomId });
	};

	const makeMove = (move: Move) => {
		socket.emit('make_move', { roomId, move });
	};

	const forfeit = () => {
		socket.emit('game_over', { forfeit: true });
	};

	useEffect(() => {
		if (shouldConnect) {
			//@ts-ignore
			socket.auth = { username, gameId, userId };
			socket.connect();
		}

		socket.on('users', (users: User[]) => {
			const creator = users.find((x: User) => x.userType === 'creator');
			const creatorIndex = users.findIndex(
				(x: User) => x.userType === 'creator'
			);
			users.splice(creatorIndex, 1);

			if (creator) {
				users.unshift(creator);
			}

			console.log("users", users)
			users.forEach((user) => {
				user.self = user.userId === userId;
				console.log("user", user)
				console.log("userid", userId)
			});

			setPlayers(users);
		});

		socket.on('roomId', (data: string) => {
			setRoomId(data);
			const url = `${window.location.origin}/game/${data}`
			if(url !== window.location.href){
				window.history.pushState(null, '', url)
			}
		});

		socket.on('readied', (data: any) => {
			setReadied([...readied, data.userId]);
		});

		socket.on('game', (game: { gameState: GameState; players: User[] }) => {
			if (game.gameState) {
				setGameState(game.gameState);

				const users = game.players;
				users.forEach((user) => {
					user.self = user.userId === userId;
				});

				setPlayers(users);
				setShouldConnect(false);
				setState('game');
			}
		});

		socket.on('game_updated', (game: any) => {
			setGameState(game.gameState);

			if (game.gameState.game_over) {
				socket.emit('game_over', { forfeit: false });
			}
		});
		socket.on('users_updated', (data: any) => {
			const users: User[] = data.users;
			users.forEach((user) => {
				user.self = user.userId === userId;
			});
			setPlayers(users);
		});

		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state]);

	useEffect(() => {
		socket.on('user_disconnected', (msg: {user: string}) => {
			console.log(`${msg.user} has disconnected`)
			swal.fire({
				title: <div>{msg.user} has disconnected</div>,
				icon: 'warning',
				text: 'Please wait for them to reconnect'
			})
		})
		socket.on('user_reconnected', (msg: {user: string}) => {
			console.log(`${msg.user} has reconnected`)
			swal.fire({
				title: <div>{msg.user} has reconnected</div>,
				icon: 'success',
				text: 'You may continue playing'
			})
		})
		socket.on('game_over_notification', (notif: any) => {
			swal
				.fire({
					title: <span>Game Over</span>,
					html: <div>{notif.message}!</div>,
					icon: 'warning',
					showConfirmButton: true,
					confirmButtonColor: '#9045d6',
				})
				.then((response) => {
					if (response.isConfirmed) {
						
					}
				});
		});
		socket.on('game_destroyed', () => {
			swal
				.fire({
					title: <span>Game Over</span>,
					html: (
						<div>Opponent disconnected! Kicking everyone from the room</div>
					),
					icon: 'warning',
					showConfirmButton: true,
					confirmButtonColor: '#9045d6',
				})
				.then((response) => {
					if (response.isConfirmed) {
						
					}
				});
		});
		socket.on('disconnect', () => {
			swal.fire({
				title: <div>You have disconnected</div>,
				icon: 'warning',
				text: 'Please rejoin the game without exiting this tab to reconnect'
			})
		})

		return () => {
			socket.disconnect();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	switch (state) {
		case 'game':
			return (
				<GungiGame
					gameState={gameState}
					players={players}
					userId={userId}
					playersReadied={readied}
					makeMoveCallback={makeMove}
					forfeitCallback={forfeit}
				/>
			);
		case 'lobby':
			return (
				<Lobby
					roomId={roomId}
					players={players}
					startGameCallback={startGame}
				/>
			);
		case 'login':
			return (
				<Login
					username={username}
					setUsername={setUsername}
					callback={chooseName}
				/>
			);
	}
};
