import { EventEmitter } from 'events';


export class AgentParser extends EventEmitter {
  private buffer = '';
  
  public push(data: string) {
    this.buffer += data;
    
    // Send words/chunks as they come, but structured.
    // In a full implementation, we would detect specific agent states.
    if (this.buffer.length > 0) {
      this.emit('message', {
        type: 'agent_message',
        content: this.buffer,
        timestamp: Date.now()
      });
      this.buffer = '';
    }
  }

  public flush() {
    if (this.buffer.length > 0) {
      this.emit('message', {
        type: 'agent_message',
        content: this.buffer,
        timestamp: Date.now()
      });
      this.buffer = '';
    }
  }
}
