"""Real RFC 6238 enrollment for integration clients; no server-side bypass."""
import base64, hashlib, hmac, struct
from datetime import datetime

def code(secret, now):
 step=int(datetime.fromisoformat(now.replace('Z','+00:00')).timestamp())//30
 value=hmac.new(base64.b32decode(secret),struct.pack('>Q',step),hashlib.sha1).digest()
 offset=value[-1]&15
 return str((struct.unpack('>I',value[offset:offset+4])[0]&0x7fffffff)%1000000).zfill(6)

def enroll(call, now, prefix=''):
 seed=call(prefix+'auth/mfa/setup',{})['secret']
 return call(prefix+'auth/mfa/verify',{'code':code(seed,now)})['recovery_codes']
