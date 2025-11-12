import os
import json
import base64
import asyncio
import aiohttp
import websockets
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv


# uvicorn app.main:app --reload

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
LLM_MODEL = "gpt-4o-mini"  



conversation_log = []  

GMAIL_ADDRESS = os.getenv("GMAIL_ADDRESS")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD") 

def send_email_report(to_email: str, subject: str, body: str):
    """Send an email with EMI analysis to the user."""
    msg = MIMEText(body, "plain")
    msg["Subject"] = subject
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = to_email

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_ADDRESS, [to_email], msg.as_string())
        print(f"✅ Email sent to {to_email}")
        return True
    except Exception as e:
        print("⚠️ Email send failed:", e)
        return False
    


async def handle_field_confirmation(conversation_segment: str, websocket, session_state: dict):
    """
    Detects new or corrected field values from a partial conversation segment
    and manages pending/confirmed updates for UI.
    """
    print("🧩 HANDLE_FIELD_CONFIRMATION: Checking for field updates...")
    
    # Initialize state
    if "pending_fields" not in session_state:
        session_state["pending_fields"] = {}
    if "confirmed_fields" not in session_state:
        session_state["confirmed_fields"] = {}

    # Step 1️⃣ — Ask model to detect latest mention + confirmation intent
    prompt = f"""
        From this conversation segment, identify if the user has either:
        - Provided a new field value, or
        - Corrected or confirmed an earlier one.

        Extract only the fields and confirmation status.
        Return JSON like:
        {{
          "updates": {{
             "email_address": {{"value": "ardra777@gmail.com", "confirmed": true}},
             "first_name": {{"value": "Ardra", "confirmed": false}}
          }}
        }}
        If no updates, return {{ "updates": {{}} }}.

        Conversation Segment:
        \"\"\"{conversation_segment}\"\"\"
    """

    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": "You detect new or corrected fields and mark confirmed true/false. Return valid JSON only."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
        "max_tokens": 200,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=body) as resp:
                data = await resp.json()
                raw = data["choices"][0]["message"]["content"].strip()
                print("📥 Raw response:", raw)

                # Parse JSON safely
                try:
                    updates = json.loads(raw).get("updates", {})
                except:
                    start, end = raw.find("{"), raw.rfind("}")
                    updates = json.loads(raw[start:end+1]).get("updates", {}) if start != -1 and end != -1 else {}

                # Step 2️⃣ — Process updates
                for field, info in updates.items():
                    value = info.get("value")
                    confirmed = info.get("confirmed", False)
                    if not value:
                        continue

                    if confirmed:
                        session_state["confirmed_fields"][field] = value
                        print(f"✅ CONFIRMED: {field} = {value}")
                        await websocket.send_json({
                            "type": "field_confirmed",
                            "field": field,
                            "value": value
                        })
                    else:
                        session_state["pending_fields"][field] = value
                        print(f"🕓 PENDING: {field} = {value}")
                        await websocket.send_json({
                            "type": "field_pending",
                            "field": field,
                            "value": value
                        })

                return session_state
    except Exception as e:
        print(f"❌ HANDLE_FIELD_CONFIRMATION ERROR: {e}")
        return session_state




async def extract_user_fields(conversation: str, timeout: int = 10):
    print("🎯 EXTRACT_USER_FIELDS: Starting extraction process")
    print(f"📥 Input conversation length: {len(conversation)} characters")
    
    # Add consent extraction logic to the instruction
    prompt = f"""
        You are a JSON extractor. From the short conversation below, extract the following fields:
        - first_name
        - date_of_birth (DD-MM-YYYY)
        - monthly_salary (integer, INR)
        - phone_number
        - email_address
        - loan_amount (integer, INR)
        - loan_tenure_years (integer, years)
        - email_consent (boolean: true if the user explicitly agrees to receive loan report by email, false otherwise)

        Return ONLY a single valid JSON object with those keys.
        If a field is not present, set its value to null.
        For email_consent:
          - true → if user says yes, agrees, or confirms they want the report sent to email.
          - false → if user says no, declines, or does not mention it.

        Example:
        {{
          "first_name": "Ardra",
          "date_of_birth": "12-05-1996",
          "monthly_salary": 75000,
          "phone_number": "9876543210",
          "email_address": "ardra@example.com",
          "loan_amount": 3000000,
          "loan_tenure_years": 20,
          "email_consent": true
        }}

        Conversation:
        \"\"\"{conversation}\"\"\"
    """
    
    url = "https://api.openai.com/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    body = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": "You extract fields as requested. Return ONLY valid JSON, no other text."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.0,
        "max_tokens": 300,
    }

    print("🔄 Making OpenAI API call for extraction...")
    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(url, headers=headers, json=body, timeout=timeout) as resp:
                print(f"📡 OpenAI API response status: {resp.status}")
                
                if resp.status != 200:
                    text = await resp.text()
                    print(f"❌ OpenAI API error: {resp.status} - {text}")
                    raise RuntimeError(f"OpenAI error {resp.status}: {text}")

                data = await resp.json()
                print("✅ OpenAI API call successful")
                
                content = data["choices"][0]["message"]["content"].strip()
                print(f"📄 Raw model response: '{content}'")

                # Parse the LLM output as JSON
                try:
                    parsed = json.loads(content)
                    print(f"📊 Successfully parsed JSON: {parsed}")
                except json.JSONDecodeError as e:
                    print(f"❌ JSON decode error: {e}")
                    print(f"🔍 Trying to extract JSON from response...")
                    
                    start = content.find('{')
                    end = content.rfind('}')
                    if start != -1 and end != -1:
                        json_text = content[start:end + 1]
                        try:
                            parsed = json.loads(json_text)
                            print(f"✅ Successfully parsed extracted JSON: {parsed}")
                        except:
                            print("❌ Failed to parse extracted JSON")
                            parsed = {}
                    else:
                        print("❌ No JSON found in response")
                        parsed = {}

                # Construct final structured output
                result = {
                    "first_name": parsed.get("first_name"),
                    "date_of_birth": parsed.get("date_of_birth"),
                    "monthly_salary": parsed.get("monthly_salary"),
                    "phone_number": parsed.get("phone_number"),
                    "email_address": parsed.get("email_address"),
                    "loan_amount": parsed.get("loan_amount"),
                    "loan_tenure_years": parsed.get("loan_tenure_years"),
                    "email_consent": parsed.get("email_consent", False)  # Default false
                }

                # Count extracted fields
                extracted_count = sum(1 for v in result.values() if v not in [None, False])
                print(f"✅ EXTRACT_USER_FIELDS COMPLETE: {extracted_count}/{len(result)} fields extracted")
                print(f"📋 Final result: {result}")
                return result

        except Exception as e:
            print(f"❌ EXTRACT_USER_FIELDS ERROR: {e}")
            import traceback
            traceback.print_exc()
            return {
                "first_name": None,
                "date_of_birth": None,
                "monthly_salary": None,
                "phone_number": None,
                "email_address": None,
                "loan_amount": None,
                "loan_tenure_years": None,
                "email_consent": False
            }

        

async def calculate_loan_details(user_data: dict):
    """
    Calculate EMI, eligibility based on extracted user data
    """
    print("🧮 CALCULATE_LOAN_DETAILS: Starting calculations")
    
    monthly_salary = user_data.get("monthly_salary")
    loan_amount = user_data.get("loan_amount")
    loan_tenure_years = user_data.get("loan_tenure_years")
    
    # If we don't have required data, return empty calculations
    if not all([monthly_salary, loan_amount, loan_tenure_years]):
        return {
            "eligible": False,
            "emi_amount": None,
            "max_eligible_amount": None,
            "reason": "Waiting for salary, loan amount, and tenure data"
        }
    
    try:
        # Your business logic calculations
        annual_salary = monthly_salary * 12
        max_eligible = annual_salary * 5  # 5 times annual salary
        
        # Check eligibility
        eligible = loan_amount <= max_eligible
        reason = "Eligible" if eligible else f"Loan amount exceeds maximum eligible amount of ₹{max_eligible:,.0f}"
        
        # EMI calculation (if eligible)
        if eligible:
            interest_rate = 9.0  # 9% annual
            monthly_rate = interest_rate / 12 / 100
            months = loan_tenure_years * 12
            
            emi = (loan_amount * monthly_rate * (1 + monthly_rate) ** months) / \
                  ((1 + monthly_rate) ** months - 1)
            
            calculations = {
                "eligible": True,
                "emi_amount": round(emi),
                "max_eligible_amount": max_eligible,
                "loan_amount": loan_amount,
                "loan_tenure_years": loan_tenure_years,
                "monthly_salary": monthly_salary,
                "interest_rate": interest_rate,
                "total_payable": round(emi * months),
                "total_interest": round((emi * months) - loan_amount),
                "reason": reason
            }
        else:
            calculations = {
                "eligible": False,
                "emi_amount": None,
                "max_eligible_amount": max_eligible,
                "loan_amount": loan_amount,
                "loan_tenure_years": loan_tenure_years,
                "monthly_salary": monthly_salary,
                "interest_rate": 9.0,
                "total_payable": None,
                "total_interest": None,
                "reason": reason
            }
        
        print(f"✅ CALCULATIONS COMPLETE: {calculations}")
        return calculations
        
    except Exception as e:
        print(f"❌ CALCULATION ERROR: {e}")
        return {
            "eligible": False,
            "emi_amount": None,
            "max_eligible_amount": None,
            "reason": f"Calculation error: {str(e)}"
        }

SYSTEM_PROMPT = """
You are a friendly, voice-based home loan EMI calculator English assistant. 

Your role is to:
1. Start by introducing yourself warmly, for example:
   "Hello! I'm your Home Loan EMI Assistant. I can help you calculate your EMI, check eligibility, or answer questions about home loans. 
   Would you like to calculate your EMI or do you have any questions about loans first?"

2. If the user wants to calculate EMI, proceed to collect the following fields conversationally, one at a time: and confirm each before moving to the next:
   - First name
   - Date of birth (DD-MM-YYYY)
   - Monthly salary
   - Phone number
   - Email address
   - Desired loan amount
   - Desired tenure in years 
   Stricly don't proceed without confirming each field or without valid fields.


3. Apply these validations:
   - Loan amount should be <= 5 times the annual income (monthly salary * 12 * 5)
   - Age + tenure should be <= 65 years

4. Once all inputs are valid:
   - Calculate EMI using the formula:
     EMI = [P × R × (1+R)^N] / [(1+R)^N − 1]
       Where:
       P = Loan amount
       R = Monthly interest rate (9% annual = 9/12/100 = 0.0075 monthly)
       N = Loan tenure in months (years × 12)

5. Provide a clear and friendly explanation of the EMI result.
   Then, politely ask the user if they would like to receive this EMI analysis report by email
   for their future reference. 
   Example prompt:
   "Would you like me to send this EMI summary to your email for future reference?"

   - If the user says yes, record their consent as true.
   - If they decline or say no, record consent as false.

6. If validation fails, explain clearly why and ask for corrected input.

7. Keep responses concise and easy to understand for voice interaction.

 **Very Important Rule:**
   - Ignore any unclear, low-volume, or background voices that do not sound like direct, intentional user input.
   - Never assume values unless the user clearly confirms them.
   - If a response is partially heard or uncertain, ask the user politely to repeat it (e.g., “I couldn’t catch that clearly — could you please repeat?”).

Maintain a polite, patient, and professional tone throughout. Don't shift to any other language in any circumstances. Always reply in English.
If the user only has general questions about EMI or loans, answer them conversationally before offering to start the calculation.
"""



@app.websocket("/realtime/ws/realtime")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("🟢 Frontend connected to /realtime/ws/realtime")

    conversation_log = []  # 🧠 Maintain conversation turns
    session_state = {}     # 🧠 Store pending/confirmed fields across turns
    print("🆕 New conversation log and session state initialized")

    try:
        print("⏳ Waiting for config from frontend...")
        config_msg = await websocket.receive_text()
        print(f"📨 Received config: {config_msg}")
        
        cfg = json.loads(config_msg)
        if cfg.get("type") == "config":
            await websocket.send_json({"type": "config_ack"})
            print("✅ Config acknowledged")

        print("🔵 Connecting to OpenAI Realtime API...")
        async with websockets.connect(
            "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
            additional_headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "OpenAI-Beta": "realtime=v1",
            },
        ) as openai_ws:
            print("🟢 Connected to OpenAI Realtime API")

            session_update = {
                "type": "session.update",
                "session": {
                    "model": "gpt-4o-realtime-preview",
                    "voice": "cedar",
                    "modalities": ["text", "audio"],
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "instructions": SYSTEM_PROMPT.strip(),
                },
            }
            await openai_ws.send(json.dumps(session_update))
            print("📤 Sent session update to OpenAI")

            # ------------------------------
            # 🧠 Background field extraction
            # ------------------------------
            async def run_field_extraction(conversation_text, websocket):
                print("🎯 EXTRACTION TASK STARTED: run_field_extraction called")
                print(f"📥 Input conversation length: {len(conversation_text)} chars")
                
                try:
                    print("🔄 Calling extract_user_fields...")
                    fields = await extract_user_fields(conversation_text)
                    print(f"✅ EXTRACTION COMPLETE: Got fields: {fields}")
                    
                    # Send extracted fields to frontend
                    sent_count = 0
                    for field_name, field_value in fields.items():
                        if field_value is not None:
                            print(f"📤 Sending field to frontend: {field_name} = {field_value}")
                            await websocket.send_json({
                                "type": "field_extracted",
                                "field": field_name,
                                "value": field_value
                            })
                            sent_count += 1
                    
                    print("🧮 Running loan calculations...")
                    calculations = await calculate_loan_details(fields)
                    await websocket.send_json({
                        "type": "loan_calculations", 
                        "data": calculations
                    })
                    print(f"✅ Sent {sent_count} fields + loan calculation results to frontend")

                    # ---------------------------------------------------------
                    # 📧 EMAIL REPORT SECTION (only if user consented)
                    # ---------------------------------------------------------
                    # user_email = fields.get("email_address")  
                    user_email = "ardrar777@gmail.com"  # Use extracted email, not hardcoded
                    user_consent = fields.get("email_consent", False)
                    print(f"📧 Preparing to send email. Email: {user_email}, Consent: {user_consent}")
                    
                    try:
                        if user_email or user_consent:
                            print(f"📨 Preparing email report for {user_email}")
                            
                            subject = "Your Home Loan Analysis Report"
                            body = (
                                "Hello!\n\n"
                                "Here's a summary of your home loan analysis:\n\n"
                                f"Name: {fields.get('first_name', 'N/A')}\n"
                                f"Loan Amount: ₹{fields.get('loan_amount', 0):,}\n"
                                f"Monthly Salary: ₹{fields.get('monthly_salary', 0):,}\n"
                                f"Tenure: {fields.get('loan_tenure_years', 'N/A')} years\n\n"
                                f"Estimated EMI: ₹{calculations.get('emi_amount', 0):,}\n"
                                f"Total Payable: ₹{calculations.get('total_payable', 0):,}\n"
                                f"Total Interest: ₹{calculations.get('total_interest', 0):,}\n"
                                f"Eligibility Status: {'✅ Eligible' if calculations.get('eligible') else '❌ Not Eligible'}\n"
                                f"Remarks: {calculations.get('reason', 'N/A')}\n\n"
                                "Thank you for using our Home Loan Assistant!"
                            )

                            print(f"📝 Email body prepared, calling send_email_report...")
                            
                            # Run email in a thread to avoid blocking
                            try:
                                success = await asyncio.wait_for(
                                    asyncio.to_thread(send_email_report, user_email, subject, body),
                                    timeout=10.0  # 10 second timeout
                                )
                            except asyncio.TimeoutError:
                                print("⏰ Email sending timed out after 10 seconds")
                                success = False
                            
                            if success:
                                print(f"✅ Email report sent to {user_email}")
                                await websocket.send_json({
                                    "type": "email_status",
                                    "status": "sent",
                                    "to": user_email
                                })
                            else:
                                print(f"❌ Failed to send email to {user_email}")
                                await websocket.send_json({
                                    "type": "email_status",
                                    "status": "failed",
                                    "to": user_email
                                })
                        else:
                            print(f"⚠️ Email not sent: missing user email or consent. Email: {user_email}, Consent: {user_consent}")

                    except Exception as e:
                        print(f"Unexpected error in email handling: {e}")
                        import traceback
                        traceback.print_exc()

                except Exception as e:
                    print(f"❌ EXTRACTION TASK FAILED: {e}")
                    import traceback
                    traceback.print_exc()

            # ------------------------------
            # 🔄 Field confirmation handler
            # ------------------------------
            async def run_field_confirmation(conversation_segment, websocket):
                print("🧩 FIELD CONFIRMATION: Checking for field updates...")
                try:
                    updated_state = await handle_field_confirmation(conversation_segment, websocket, session_state)
                    # Update the session state with any changes
                    session_state.update(updated_state)
                    print(f"✅ Field confirmation completed. Confirmed: {len(session_state.get('confirmed_fields', {}))}, Pending: {len(session_state.get('pending_fields', {}))}")
                except Exception as e:
                    print(f"❌ FIELD CONFIRMATION ERROR: {e}")
                    import traceback
                    traceback.print_exc()

            # ------------------------------
            # 🎤 Frontend → OpenAI
            # ------------------------------
            async def frontend_to_openai():
                print("🔄 Starting frontend→OpenAI relay")
                try:
                    async for msg in websocket.iter_bytes():
                        print(f"🎤 Received audio chunk: {len(msg)} bytes")
                        
                        if msg == b"end_of_audio":
                            print("🎤 End of audio detected - committing buffer and triggering response")
                            await openai_ws.send(json.dumps({
                                "type": "input_audio_buffer.commit"
                            }))
                            await openai_ws.send(json.dumps({
                                "type": "response.create"
                            }))
                            # Track user turn
                            conversation_log.append({"role": "user", "text": "[user spoke audio]"})
                            print(f"📝 Added user turn to conversation log. Total turns: {len(conversation_log)}")
                            print("📤 Audio committed and response triggered")
                            continue

                        b64_audio = base64.b64encode(msg).decode("utf-8")
                        await openai_ws.send(json.dumps({
                            "type": "input_audio_buffer.append",
                            "audio": b64_audio
                        }))
                except Exception as e:
                    print(f"❌ frontend_to_openai error: {str(e)}")
                    raise

            # ------------------------------
            # 🤖 OpenAI → Frontend
            # ------------------------------
            async def openai_to_frontend():
                print("🔄 Starting OpenAI→frontend relay")
                try:
                    async for msg in openai_ws:
                        data = json.loads(msg)
                        event_type = data.get("type")
                        print(f"📊 Event type: {event_type}")

                        if event_type == "response.audio_transcript.delta":
                            text = data.get("delta", "").strip()
                            if text:
                                print(f"💬 Assistant transcript: '{text}'")
                                await websocket.send_json({
                                    "type": "chat_message",
                                    "role": "assistant", 
                                    "text": text
                                })

                                # Append assistant text to conversation
                                if conversation_log and conversation_log[-1]["role"] == "assistant":
                                    conversation_log[-1]["text"] += " " + text
                                    print(f"📝 Updated last assistant message: '{conversation_log[-1]['text']}'")
                                else:
                                    conversation_log.append({"role": "assistant", "text": text})
                                    print(f"📝 Added new assistant message: '{text}'")
                                
                                print(f"📋 Conversation log now has {len(conversation_log)} turns")

                        elif event_type == "response.audio.delta":
                            print("🎵 Sending audio chunk to frontend")
                            await websocket.send_json({"type": "tts_start"})
                            try:
                                audio_chunk = base64.b64decode(data["delta"])
                                await websocket.send_bytes(audio_chunk)
                                await websocket.send_json({"type": "tts_end"})
                                print("✅ Audio chunk sent successfully")
                            except Exception as e:
                                print(f"❌ Audio processing error: {str(e)}")

                        elif event_type == "response.created":
                            print("🚀 Response created event")

                        elif event_type == "response.done":
                            print("✅ Response done event")
                            
                            # 🎯 COMPREHENSIVE LOGGING FOR EXTRACTION TRIGGER
                            print("🎯 EXTRACTION TRIGGER: Response done received, preparing for field extraction")
                            print(f"📊 Conversation log length: {len(conversation_log)} turns")
                            
                            # Collect text conversation so far
                            conversation_text = "\n".join(
                                [f"{m['role']}: {m['text']}" for m in conversation_log]
                            )
                            
                            print("🧠 Full conversation text ready for extraction:")
                            print(f"📏 Conversation text length: {len(conversation_text)} characters")
                            
                            # Run both extraction and confirmation in background
                            print("🚀 Creating background extraction and confirmation tasks...")
                            
                            # Run field extraction (existing functionality)
                            extraction_task = asyncio.create_task(run_field_extraction(conversation_text, websocket))
                            
                            # Run field confirmation (new functionality) - use last few turns for confirmation
                            if len(conversation_log) >= 2:
                                recent_conversation = "\n".join(
                                    [f"{m['role']}: {m['text']}" for m in conversation_log[-4:]]  # Last 4 turns
                                )
                                confirmation_task = asyncio.create_task(run_field_confirmation(recent_conversation, websocket))
                            
                            print("✅ Background tasks created")

                        elif event_type == "session.updated":
                            print("⚙️ Session updated event")

                        else:
                            print(f"📝 Other event type: {event_type}")

                except Exception as e:
                    print(f"❌ openai_to_frontend error: {str(e)}")
                    raise

            print("🔄 Starting bidirectional relay...")
            await asyncio.gather(
                frontend_to_openai(),
                openai_to_frontend(),
                return_exceptions=True
            )

    except websockets.exceptions.ConnectionClosed:
        print("🔴 WebSocket connection closed by client")
        
    except json.JSONDecodeError as e:
        print(f"❌ JSON decode error: {str(e)}")
        await websocket.send_json({"type": "error", "message": "Invalid JSON"})
        
    except Exception as e:
        print(f"❌ WebSocket error: {str(e)}")
        import traceback
        traceback.print_exc()
        await websocket.send_json({"type": "error", "message": str(e)})

    finally:
        print("🔴 Connection closed")
        print(f"📊 Final conversation log had {len(conversation_log)} turns")
        print(f"📋 Final session state: {session_state}")