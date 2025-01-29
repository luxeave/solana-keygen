import React, { useState, useEffect, useRef } from "react";
import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import bs58 from "bs58";

// Polyfill for Buffer
window.Buffer = window.Buffer || require('buffer').Buffer;

function App() {
  // ---------------------------------------------------------------------------
  // 1) Setup connection to Solana Testnet
  // ---------------------------------------------------------------------------
  const [connection] = useState(
    () => new Connection(clusterApiUrl(process.env.REACT_APP_SOLANA_NETWORK), "confirmed")
  );

  // ---------------------------------------------------------------------------
  // 2) State: Load addresses from localStorage on initial render
  // ---------------------------------------------------------------------------
  const [addresses, setAddresses] = useState(() => {
    const savedAddresses = localStorage.getItem('solanaAddresses');
    return savedAddresses ? JSON.parse(savedAddresses) : [];
  });

  // ---------------------------------------------------------------------------
  // 3) Save addresses to localStorage whenever they change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    localStorage.setItem('solanaAddresses', JSON.stringify(addresses));
  }, [addresses]);

  // ---------------------------------------------------------------------------
  // 4) Create Keypair & Add to List
  // ---------------------------------------------------------------------------
  const createSolanaAddress = () => {
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toString();
    const secretKeyBase58 = bs58.encode(keypair.secretKey);

    setAddresses((prev) => [
      ...prev,
      {
        id: Date.now(),
        publicKey,
        privateKey: secretKeyBase58,
        showPrivate: false,
        balance: 0,
      },
    ]);
  };

  // ---------------------------------------------------------------------------
  // 5) Delete Address
  // ---------------------------------------------------------------------------
  const deleteAddress = (id) => {
    setAddresses((prev) => prev.filter(addr => addr.id !== id));
  };

  // Rest of your existing code remains the same until the render section
  const togglePrivateKey = (id) => {
    setAddresses((prev) =>
      prev.map((addr) =>
        addr.id === id ? { ...addr, showPrivate: !addr.showPrivate } : addr
      )
    );
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).catch((err) => console.error(err));
  };

  const getBalance = async (publicKeyString) => {
    try {
      const publicKey = new PublicKey(publicKeyString);
      const balance = await connection.getBalance(publicKey);
      return balance;
    } catch (err) {
      console.error("Error getting balance:", err);
      return 0;
    }
  };

  const refreshBalance = async (id) => {
    const updatedAddresses = await Promise.all(
      addresses.map(async (addr) => {
        if (addr.id === id) {
          const balanceLamports = await getBalance(addr.publicKey);
          return {
            ...addr,
            balance: balanceLamports / LAMPORTS_PER_SOL,
          };
        }
        return addr;
      })
    );
    setAddresses(updatedAddresses);
  };

  const [faucetAmount, setFaucetAmount] = useState("1");
  const requestAirdrop = async (id) => {
    try {
      const targetAddr = addresses.find((item) => item.id === id);
      if (!targetAddr) return;
      const publicKey = new PublicKey(targetAddr.publicKey);
      
      // Limit airdrop to 2 SOL maximum
      const requestedAmount = parseFloat(faucetAmount);
      if (requestedAmount > 2) {
        alert("Maximum airdrop amount is 2 SOL on testnet");
        return;
      }
      
      const lamports = requestedAmount * LAMPORTS_PER_SOL;
      console.log(`Requesting airdrop of ${requestedAmount} SOL to ${publicKey.toString()}...`);
      
      const signature = await connection.requestAirdrop(publicKey, lamports);
      await connection.confirmTransaction(signature, "confirmed");
      console.log('Airdrop successful:', signature);
      alert(`Airdrop successful! Signature: ${signature}`);

      await refreshBalance(id);
    } catch (err) {
      console.error("Error in airdrop:", err);
      alert("Airdrop failed! " + err.message);
    }
  };

  const [transferData, setTransferData] = useState({
    fromId: "",
    toPubkey: "",
    amount: "",
  });

  const handleTransferChange = (e) => {
    const { name, value } = e.target;
    setTransferData((prev) => ({ ...prev, [name]: value }));
  };

  const transferSOL = async () => {
    try {
      const { fromId, toPubkey, amount } = transferData;
      
      // Input validation
      if (!fromId || !toPubkey || !amount) {
        alert("Please fill in all transfer details");
        return;
      }

      const fromAddr = addresses.find((item) => item.id.toString() === fromId);
      if (!fromAddr) {
        alert("Invalid From address selection.");
        return;
      }

      // Validate amount is a positive number
      const transferAmount = parseFloat(amount);
      if (isNaN(transferAmount) || transferAmount <= 0) {
        alert("Please enter a valid positive amount");
        return;
      }

      // Check if sender has sufficient balance (including fees)
      const senderBalance = parseFloat(fromAddr.balance);
      if (senderBalance < transferAmount + 0.000005) { // Adding a small amount for fees
        alert("Insufficient balance. Please ensure you have enough SOL for transfer and fees.");
        return;
      }

      // Validate destination address
      let toPublicKey;
      try {
        toPublicKey = new PublicKey(toPubkey);
        if (!PublicKey.isOnCurve(toPublicKey.toBytes())) {
          alert("Invalid destination address");
          return;
        }
      } catch (err) {
        alert("Invalid destination address format");
        return;
      }

      const secretKey = bs58.decode(fromAddr.privateKey);
      const fromKeypair = Keypair.fromSecretKey(secretKey);
      const lamports = transferAmount * LAMPORTS_PER_SOL;

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fromKeypair.publicKey,
          toPubkey: toPublicKey,
          lamports,
        })
      );

      transaction.feePayer = fromKeypair.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      transaction.sign(fromKeypair);

      const signature = await connection.sendRawTransaction(
        transaction.serialize()
      );

      console.log("Transaction sent:", signature);
      
      // Wait for confirmation with timeout
      const confirmation = await Promise.race([
        connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Transaction confirmation timeout")), 30000)
        )
      ]);

      if (confirmation?.value?.err) {
        throw new Error("Transaction failed: " + JSON.stringify(confirmation.value.err));
      }

      alert(`Transfer successful! Transaction signature: ${signature}`);
      await refreshBalance(fromAddr.id);
      
      // Clear transfer form
      setTransferData({
        fromId: "",
        toPubkey: "",
        amount: "",
      });
      
    } catch (err) {
      console.error("Error transferring SOL:", err);
      alert(`Transfer failed: ${err.message}`);
    }
  };

  const fileInputRef = useRef(null);

  // Backup keypairs to file
  const backupKeypairs = () => {
    try {
      const data = JSON.stringify(addresses, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'solana-keypairs.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error backing up keypairs:', err);
      alert('Failed to backup keypairs: ' + err.message);
    }
  };

  // Load keypairs from file
  const loadKeypairs = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const loadedAddresses = JSON.parse(e.target.result);
        
        // Validate the loaded data structure
        if (!Array.isArray(loadedAddresses)) {
          throw new Error('Invalid file format: expected an array of keypairs');
        }
        
        // Validate each keypair
        loadedAddresses.forEach(addr => {
          if (!addr.publicKey || !addr.privateKey || !addr.id) {
            throw new Error('Invalid keypair format');
          }
          // Validate Solana public key format
          try {
            new PublicKey(addr.publicKey);
          } catch (err) {
            throw new Error('Invalid public key format');
          }
          // Validate private key format (should be base58 encoded)
          try {
            const decoded = bs58.decode(addr.privateKey);
            if (decoded.length !== 64) {
              throw new Error('Invalid private key length');
            }
          } catch (err) {
            throw new Error('Invalid private key format');
          }
        });

        // Merge with existing addresses, avoiding duplicates
        setAddresses(prev => {
          const existingPubKeys = new Set(prev.map(a => a.publicKey));
          const newAddresses = loadedAddresses.filter(addr => !existingPubKeys.has(addr.publicKey));
          return [...prev, ...newAddresses];
        });
        
        alert('Successfully loaded keypairs');
      } catch (err) {
        console.error('Error loading keypairs:', err);
        alert('Failed to load keypairs: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Solana Keypair Demo</h1>

      {/* Create New Address and Backup/Load buttons */}
      <div style={{ marginBottom: "20px" }}>
        <button 
          onClick={createSolanaAddress}
          style={{ marginRight: "10px" }}
        >
          Create New Keypair
        </button>
        <button 
          onClick={backupKeypairs}
          style={{ marginRight: "10px" }}
        >
          Backup Keypairs
        </button>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".json"
          onChange={loadKeypairs}
        />
        <button 
          onClick={() => fileInputRef.current?.click()}
        >
          Load Keypairs
        </button>
      </div>

      <hr />

      {/* List of Addresses */}
      {addresses.map((addr) => (
        <div
          key={addr.id}
          style={{
            border: "1px solid #ccc",
            padding: "10px",
            marginBottom: "10px",
          }}
        >
          <p>
            <strong>Public Key:</strong> {addr.publicKey}{" "}
            <button onClick={() => copyToClipboard(addr.publicKey)}>
              Copy
            </button>{" "}
            <a
              href={`https://explorer.solana.com/address/${addr.publicKey}?cluster=${process.env.REACT_APP_SOLANA_NETWORK}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "underline", color: "#1a73e8" }}
            >
              View in Explorer
            </a>
          </p>
          <p>
            <strong>Private Key:</strong>{" "}
            {addr.showPrivate ? addr.privateKey : "•••••••••••••"}{" "}
            <button onClick={() => togglePrivateKey(addr.id)}>
              {addr.showPrivate ? "Hide" : "Show"}
            </button>{" "}
            <button onClick={() => copyToClipboard(addr.privateKey)}>
              Copy
            </button>
          </p>
          <p>
            <strong>Balance:</strong> {addr.balance} SOL
          </p>

          <button onClick={() => refreshBalance(addr.id)}>Refresh Balance</button>

          <div style={{ marginTop: "5px" }}>
            <input
              style={{ width: "50px" }}
              type="number"
              step="0.1"
              min="0"
              value={faucetAmount}
              onChange={(e) => setFaucetAmount(e.target.value)}
            />
            <button onClick={() => requestAirdrop(addr.id)}>Fund (Faucet)</button>
            <a 
              href="https://faucet.solana.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginLeft: "10px", textDecoration: "underline", color: "#1a73e8" }}
            >
              Use Solana Faucet Website
            </a>
          </div>

          <button
            onClick={() => deleteAddress(addr.id)}
            style={{
              marginTop: "10px",
              backgroundColor: "#ff4444",
              color: "white",
              border: "none",
              padding: "5px 10px",
              cursor: "pointer"
            }}
          >
            Delete Address
          </button>
        </div>
      ))}

      <hr />

      {/* Transfer Form */}
      <h2>Transfer SOL</h2>
      <div style={{ marginBottom: "10px" }}>
        <label>From Address:</label>
        <select
          name="fromId"
          value={transferData.fromId}
          onChange={handleTransferChange}
        >
          <option value="">Select an address</option>
          {addresses.map((addr) => (
            <option key={addr.id} value={addr.id}>
              {addr.publicKey}
            </option>
          ))}
        </select>
      </div>
      <div style={{ marginBottom: "10px" }}>
        <label>To Public Key:</label>
        <input
          type="text"
          name="toPubkey"
          value={transferData.toPubkey}
          onChange={handleTransferChange}
          placeholder="Destination public key"
          style={{ width: "300px" }}
        />
      </div>
      <div style={{ marginBottom: "10px" }}>
        <label>Amount (SOL):</label>
        <input
          type="number"
          name="amount"
          value={transferData.amount}
          onChange={handleTransferChange}
          placeholder="0.1"
          style={{ width: "100px" }}
        />
      </div>
      <button onClick={transferSOL}>Transfer</button>
    </div>
  );
}

export default App;