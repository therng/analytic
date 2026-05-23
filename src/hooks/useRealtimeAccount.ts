import { useState, useEffect } from 'react';

export function useRealtimeAccount(accountId: string) {
    const [realtimeData, setRealtimeData] = useState<any>(null);

    useEffect(() => {
        if (!accountId) return;
        
        // Connect to FastAPI websocket
        const ws = new WebSocket(`ws://localhost:8000/ws/account/${accountId}`);
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                setRealtimeData(data);
            } catch (e) {
                console.error("Error parsing WS message", e);
            }
        };

        ws.onclose = () => {
            console.log("WS closed for", accountId);
        };

        return () => {
            ws.close();
        };
    }, [accountId]);

    return realtimeData;
}
